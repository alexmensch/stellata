// One multiples.tsv record per component: a kept pair's two, and a SIMBAD-known component's standalone one. See README.md.

import { CATALOG_SCENE_EPOCH } from '../../../src/catalog-format/record/catalog-pure';
import { directionAtEpoch } from '../../../src/astro-core/equatorial-basis';
import { jdOfJulianYear } from '../../../src/astro-core/precession';
import { athygRowFor, resolveSpect } from '../components/component-spect-pure';
import { canonicalCompLetter, componentKey } from '../component-tokens-pure';
import { fromGaia, type ComponentAstrometry, type PairAstrometry } from '../astrometry/routes-pure';
import type { AthygRow } from '../load/athyg-pure';
import type { IdentifierIndices } from '../load/indices-pure';
import type { SimbadWdsXid } from '../load/simbad-pure';
import { massFromSpectralClass, massRatioFromComponents } from '../masses/mass-estimate-pure';
import { ORBIT_VIA_PROPERTIES, OWN, gaiaFields, hipFields, type AstrometryVia, type GaiaFields, type HipFields, type MultiplesRecord, type MultiplesRecordFields, type PhotometryVia } from '../multiples-record-pure';
import { keplerSemimajorAxisAu, type PairOrbit } from '../orbits/select-orbit-pure';
import { valueOf, type DecomposedPair, type ResolvedComponent } from '../resolve/components-pure';
import type { AnchorOffsets } from './anchor-offsets-pure';
import { gaiaPhotometryAbsmagCi } from './gaia-photometry-pure';
import { pairMagnitudes, wdsDmag, type PairMagnitudes } from './pair-photometry-pure';

/** An unresolved spectroscopic companion at half the primary's mass:
 *  q = M₂ / (M₁ + M₂) = 1/3, near the SB1 mass-ratio mode. */
export const UNKNOWN_COMPANION_MASS_RATIO_Q = 1.0 / 3.0;
/** The Kepler estimate's primary mass when its type gives none; a ∝ M^⅓,
 *  so a factor-2 error moves it ~26%. */
export const DEFAULT_PRIMARY_MASS_MSUN = 1.0;
/** e = 0 publishes no ω; π/2 puts conjunction at T₀, the eclipser minimum-epoch convention. */
export const CIRCULAR_ORBIT_OMEGA_RAD = Math.PI / 2.0;

export interface ScenePosition {
  readonly xPc: number;
  readonly yPc: number;
  readonly zPc: number;
  readonly distPc: number;
}

/** The position at the scene epoch; null without a measured position and a positive parallax. */
export function positionPc(a: ComponentAstrometry): ScenePosition | null {
  if (a.astrometryVia === 'unresolved' || a.parallaxMas === null || a.parallaxMas <= 0) return null;
  const u = directionAtEpoch(
    { raDeg: a.raDeg, decDeg: a.decDeg }, { pmRaMasyr: a.pmraMasyr, pmDecMasyr: a.pmdecMasyr }, a.refEpoch, CATALOG_SCENE_EPOCH,
  );
  const distPc = 1000.0 / a.parallaxMas;
  return { xPc: u.x * distPc, yPc: u.y * distPc, zPc: u.z * distPc, distPc };
}

/** WDS `date_last`, a year, as the JD its start falls on. */
export function wdsYearToJd(year: number | null): number | null {
  return year === null ? null : jdOfJulianYear(year);
}

interface Placement {
  readonly position: ScenePosition | null;
  readonly astrometryVia: AstrometryVia;
}

/** The component's own position, else its system's: README.md#system-inherited-positions */
function place(own: ScenePosition | null, ownVia: AstrometryVia, systemAnchor: ScenePosition | null): Placement {
  if (own !== null) return { position: own, astrometryVia: ownVia };
  if (systemAnchor !== null) return { position: systemAnchor, astrometryVia: 'system_inherited' };
  return { position: null, astrometryVia: ownVia };
}

function positionFields(p: ScenePosition | null): Pick<MultiplesRecord, 'x_pc' | 'y_pc' | 'z_pc' | 'distPc'> {
  return { x_pc: p?.xPc ?? null, y_pc: p?.yPc ?? null, z_pc: p?.zPc ?? null, distPc: p?.distPc ?? null };
}

/** The pair partner's binding, which gates the Gaia-photometry path: README.md#gaia-photometry */
interface Partner {
  readonly gaiaSourceId: string | null;
  readonly hasAthyg: boolean;
}

/** One side of a pair, its lookups made once. */
interface PairSide {
  readonly c: ResolvedComponent;
  readonly astrometry: ComponentAstrometry;
  readonly own: ScenePosition | null;
  readonly athyg: AthygRow | null;
}

function pairSide(c: ResolvedComponent, astrometry: ComponentAstrometry, indices: IdentifierIndices): PairSide {
  return { c, astrometry, own: positionPc(astrometry), athyg: athygRowFor(c, indices) };
}

type ComponentFields = Pick<
  MultiplesRecordFields,
  'comp' | 'hd' | 'x_pc' | 'y_pc' | 'z_pc' | 'distPc' | 'absmag' | 'ci' | 'spect' | 'name'
  | 'source' | 'resolveVia' | 'astrometryVia' | 'spectVia' | 'photometryVia'
> & GaiaFields & HipFields;

/** `primaryAthyg` is null on the primary's own row. */
function componentFields(
  wdsId: string, { c, astrometry, own, athyg }: PairSide, systemAnchor: ScenePosition | null,
  primaryAthyg: AthygRow | null, isPrimary: boolean, partner: Partner, indices: IdentifierIndices,
): ComponentFields {
  const { position, astrometryVia } = place(own, astrometry.astrometryVia, systemAnchor);
  const { spect, spectVia } = resolveSpect(wdsId, c.component, athyg, indices);
  let absmag = athyg?.absmag ?? null;
  let ci = athyg?.ci ?? null;
  let photometryVia: PhotometryVia = athyg === null ? 'none'
    : isPrimary || athyg !== primaryAthyg ? 'athyg_own' : 'athyg_system_inherited';
  const gaiaSourceId = valueOf(c.gaia);
  const sharesAthygPartnerSource = partner.hasAthyg && partner.gaiaSourceId !== null && partner.gaiaSourceId === gaiaSourceId;
  if (athyg === null && astrometryVia === 'gaia_5p' && gaiaSourceId !== null && !sharesAthygPartnerSource) {
    const gaia = indices.srcToAstrometry.get(gaiaSourceId);
    const derived = gaia === undefined ? null : gaiaPhotometryAbsmagCi(gaia);
    if (derived !== null) {
      ({ absmag, ci } = derived);
      photometryVia = 'gaia_photometry';
    }
  }
  return {
    comp: c.component, ...hipFields(c.hip), ...gaiaFields(c.gaia), hd: athyg?.hd ?? c.hd, ...positionFields(position),
    absmag, ci, spect, name: athyg?.proper ?? '', source: athyg === null ? 'wds' : 'athyg',
    resolveVia: c.resolveVia, astrometryVia, spectVia, photometryVia,
  };
}

type OrbitFields = Pick<MultiplesRecord, 'pDays' | 'tJd' | 'e' | 'aAU' | 'iRad' | 'omegaRad' | 'OmegaRad' | 'q' | 'aVia'>;

const NO_ORBIT_FIELDS: OrbitFields = {
  pDays: null, tJd: null, e: null, aAU: null, iRad: null, omegaRad: null, OmegaRad: null, q: null, aVia: 'none',
};

/** The orbit's elements, q backfilled from both spectral types, then — on
 *  the estimated-element routes only — q, a circular ω and a Kepler a
 *  backstopped: README.md#what-each-column-carries */
export function orbitFields(orbit: PairOrbit, primarySpect: string, secondarySpect: string): OrbitFields {
  if (orbit.orbitVia === 'none') return NO_ORBIT_FIELDS;
  const el = orbit.elements;
  let q = el.q ?? massRatioFromComponents(primarySpect, secondarySpect);
  let omegaRad = el.periastronRad;
  let aAU = el.aAu;
  let aVia: MultiplesRecord['aVia'] = aAU === null ? 'none' : 'catalog';
  if (ORBIT_VIA_PROPERTIES[orbit.orbitVia].estimatedElements) {
    q ??= UNKNOWN_COMPANION_MASS_RATIO_Q;
    if (omegaRad === null && el.e === 0) omegaRad = CIRCULAR_ORBIT_OMEGA_RAD;
    if (aAU === null && el.pDays !== null) {
      const mPrimary = massFromSpectralClass(primarySpect) ?? DEFAULT_PRIMARY_MASS_MSUN;
      const kepler = keplerSemimajorAxisAu(el.pDays, mPrimary / (1.0 - q));
      if (kepler !== null) {
        aAU = kepler;
        aVia = 'kepler_mass_estimate';
      }
    }
  }
  return { pDays: el.pDays, tJd: el.tJd, e: el.e, aAU, iRad: el.iRad, omegaRad, OmegaRad: el.nodeRad, q, aVia };
}

function geometryFields(p: DecomposedPair, mags: PairMagnitudes): Pick<
  MultiplesRecord, 'sepArcsec' | 'paDeg' | 'sepPaEpochJd' | 'dmag' | 'magPri' | 'magSec'
> {
  return {
    sepArcsec: p.pair.rhoLast, paDeg: p.pair.thetaLast, sepPaEpochJd: wdsYearToJd(p.pair.dateLast),
    dmag: wdsDmag(mags.magPri, mags.magSec), magPri: mags.magPri, magSec: mags.magSec,
  };
}

function anchorFields(
  wdsId: string, tok: string, anchors: AnchorOffsets,
): Pick<MultiplesRecord, 'anchorSepArcsec' | 'anchorPaDeg' | 'anchorComp'> {
  const offset = anchors.offsets.get(componentKey(wdsId, tok));
  return {
    anchorSepArcsec: offset?.sepArcsec ?? null, anchorPaDeg: offset?.paDeg ?? null, anchorComp: anchors.anchorBySystem.get(wdsId) ?? null,
  };
}

export interface PairRowsContext {
  readonly indices: IdentifierIndices;
  readonly anchors: AnchorOffsets;
}

export interface PairRows {
  readonly rows: readonly [MultiplesRecord, MultiplesRecord];
  /** The pair's magnitudes came from the MSC: WDS printed none. */
  readonly mscMags: boolean;
}

/** A kept pair's two records; null when neither side nor the system has a position. */
export function pairRows(
  p: DecomposedPair, astrometry: PairAstrometry, orbit: PairOrbit, systemAnchor: ScenePosition | null, ctx: PairRowsContext,
): PairRows | null {
  const { indices, anchors } = ctx;
  const ps = pairSide(p.primary, astrometry.primary, indices);
  const ss = pairSide(p.secondary, astrometry.secondary, indices);
  if (systemAnchor === null && ps.own === null && ss.own === null) return null;
  const { wdsId } = p.pair;
  const pri = componentFields(wdsId, ps, systemAnchor, null, true, {
    gaiaSourceId: valueOf(p.secondary.gaia), hasAthyg: ss.athyg !== null,
  }, indices);
  const sec = componentFields(wdsId, ss, systemAnchor, ps.athyg, false, {
    gaiaSourceId: valueOf(p.primary.gaia), hasAthyg: ps.athyg !== null,
  }, indices);
  const sTok = canonicalCompLetter(p.primary.component, p.secondary.component);
  const mags = pairMagnitudes(p.pair, p.primary.component, sTok, indices.msc);
  const shared = {
    systemId: `${wdsId}-${p.pair.components}`,
    regime: ORBIT_VIA_PROPERTIES[orbit.orbitVia].regime,
    orbitVia: orbit.orbitVia,
    ...orbitFields(orbit, pri.spect, sec.spect),
    ...geometryFields(p, mags),
  };
  return {
    rows: [
      { ...shared, ...pri, orbitRole: 'primary', ...anchorFields(wdsId, p.primary.component, anchors) },
      { ...shared, ...sec, orbitRole: 'secondary', ...anchorFields(wdsId, sTok, anchors) },
    ],
    mscMags: mags.source === 'msc',
  };
}

/** A SIMBAD-known component no kept pair emitted: `-_<comp>` system id, no orbit, no pair geometry. */
export function standaloneRow(
  xid: SimbadWdsXid, systemAnchor: ScenePosition | null, indices: IdentifierIndices, anchors: AnchorOffsets,
): MultiplesRecord {
  const gaia = xid.gaiaSourceId === null ? undefined : indices.srcToAstrometry.get(xid.gaiaSourceId);
  const own = gaia === undefined ? null : positionPc(fromGaia(gaia, 'gaia_5p'));
  const { position, astrometryVia } = place(own, gaia === undefined ? 'unresolved' : 'gaia_5p', systemAnchor);
  const { spect, spectVia } = resolveSpect(xid.wdsId, xid.component, null, indices);
  return {
    systemId: `${xid.wdsId}-_${xid.component}`, comp: xid.component, hd: null,
    ...hipFields(xid.hip === null ? null : { value: xid.hip, origin: OWN }),
    ...gaiaFields(xid.gaiaSourceId === null ? null : { value: xid.gaiaSourceId, origin: OWN }),
    ...positionFields(position), absmag: null, ci: null, spect, name: xid.simbadMainId, source: 'simbad', regime: 0,
    resolveVia: 'simbad_xid', astrometryVia, orbitVia: 'none', spectVia, photometryVia: 'none', orbitRole: 'standalone',
    ...NO_ORBIT_FIELDS,
    sepArcsec: null, paDeg: null, sepPaEpochJd: null, dmag: null, magPri: null, magSec: null,
    ...anchorFields(xid.wdsId, xid.component, anchors),
  };
}
