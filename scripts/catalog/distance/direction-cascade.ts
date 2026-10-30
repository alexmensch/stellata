// Per-row sky-direction resolution for the catalog build: Gaia DR3 5p →
// HIP2 → Tycho-2 → CNS5 → SIMBAD, with proper-motion propagation to the
// J2016.0 scene epoch. See ./README.md#direction-resolution.

import {
  equatorialTangentBasis,
  type UnitVector,
} from '../../../src/client/util/equatorial-basis';
import {
  readTable, tableLineReader, type TableRow,
} from '../../util/tsv/table-pure';
import { gaiaHas5pSolution } from './gaia-distrust';
import type { SimbadRecordKeys } from '../record/catalog-pure';
import type { Tycho2Row } from '../tycho2-parse';
import type { Declared } from '../../util/sources/source';
import { sourceRowRef, type RowKeyed, type SourceRowRef } from '../../util/sources/row-ref-pure';
import {
  lookupCns5Astrometry,
  type Cns5Astrometry,
} from '../classic-ids/classic-ids-parse';
import type { SimbadAstrometry } from '../simbad/simbad-values-parse';
import type { CascadeRefusal, CascadeResult, UniformValues } from '../cascade-result';

export const GAIA_DR3_REF_EPOCH = 2016.0;
export const HIP2_REF_EPOCH = 1991.25;
/** SIMBAD states `basic.ra` / `basic.dec` at J2000.0 whatever epoch the
 *  citation measured them at. The pull carries no epoch column, so this is
 *  measured rather than assumed — README.md#direction-resolution. */
export const SIMBAD_REF_EPOCH = 2000.0;
// Gaia DR3's native epoch: the catalogue-wide scene epoch every position
// is normalised onto. The dominant Gaia set lands here with zero
// propagation; only the HIP2 / Tycho-2 / CNS5 / SIMBAD minority advances.
// The binaries pipeline mirrors this in scripts/binaries/stage6_multiples.py
// — keep the two in sync (see /data/README.md#reference-epoch-and-proper-motion).
export const CATALOG_SCENE_EPOCH = 2016.0;

// Gaia 5p reliability + HIP2-preference thresholds, mirrored from
// scripts/binaries/stage3_astrometry.py so both pipelines route a shared
// star identically.
export const GAIA_RUWE_UNRELIABLE_THRESHOLD = 1.4;
// ipd_frac_multi_peak is a PERCENTAGE (0-100) in Gaia DR3; the gate
// fires above 2%, matching system-coherence.ts ANCHOR_IPD_MAX_PERCENT.
export const GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD = 2.0;
export const HIP2_PM_DELTA_THRESHOLD_MASYR = 50.0;

const MAS_TO_RAD = Math.PI / (180 * 3600 * 1000);

/** 5p astrometry row from `data/gaia/gaia_dr3_astrometry_catalog.tsv`.
 *  ra/dec are at J2016.0. `parallaxMas === null` marks a 2p
 *  (position-only) solution — Gaia detected the source but could not
 *  fit parallax + PM. */
export interface GaiaAstrometryCatalogRow {
  raDeg: number;
  decDeg: number;
  parallaxMas: number | null;
  parallaxErrorMas: number | null;
  pmraMasyr: number | null;
  pmdecMasyr: number | null;
  ruwe: number | null;
  ipdFracMultiPeak: number | null;
  gMag: number | null;
  bpMag: number | null;
  rpMag: number | null;
  /** DR3 `radial_velocity` (km/s), the RVS median. Null on the ~2/3 of
   *  sources RVS did not reach — magnitude-limited to G_RVS ≲ 14. */
  radialVelocityKmS: number | null;
  /** DR3 `radial_velocity_error` (km/s) — the uncertainty on that median.
   *  Non-null wherever `radial_velocity` is, in the published catalogue. */
  radialVelocityErrorKmS: number | null;
  /** The row of whichever Gaia file supplied it: the catalogue table, or the
   *  magnitude pull for a source only that term admitted. */
  ref: SourceRowRef<string>;
}

/** van Leeuwen 2007 (/data/papers/index.md#vanleeuwen2007) reduction row from
 *  `data/hipparcos/hip2_van_leeuwen.tsv`. ra/dec are at the Hipparcos epoch
 *  J1991.25 (ESA 1997, /data/papers/index.md#esa1997). */
export interface Hip2AstrometryRow {
  raDeg: number;
  decDeg: number;
  plxMas: number | null;
  plxErrorMas: number | null;
  pmRaMasyr: number | null;
  pmDeMasyr: number | null;
  ref: SourceRowRef<number>;
}

/** The reference datasets this cascade routes between. It is not their only
 *  reader — `gaiaAstrometry` also carries the photometry the V and ci cascades
 *  transform and the rv the radial term takes, and `tycho2` the BT/VT the V
 *  cascade reduces — so a column added for one cascade arrives for all of
 *  them, and the bundle is named for the cascade that ROUTES on it rather than
 *  for sole ownership. */
export interface DirectionSources {
  gaiaAstrometry: Map<string, GaiaAstrometryCatalogRow>;
  hip2: Map<number, Hip2AstrometryRow>;
  /** Every source with an NSS two-body orbit, to its row. */
  nss: ReadonlyMap<string, SourceRowRef<string>>;
  tycho2: Map<string, Tycho2Row>;
  cns5: Map<string, Cns5Astrometry>;
}

/** One record's own designations, plus the SIMBAD row the namespace ladder
 *  already resolved for it. Extends `SimbadRecordKeys` rather than restating
 *  it: the cascade's three designation-joined tiers key on exactly the
 *  namespaces that ladder walks, so a namespace added there is one the
 *  cascade can reach without a second shape to keep in step. The resolved
 *  SIMBAD row rides along because `resolveRadialVelocity` takes its value the
 *  same way — one lookup per record serves both terms of the velocity. */
export interface DirectionInputs extends SimbadRecordKeys {
  simbad: SimbadAstrometry | null;
  /** Sol, the one record carrying no identifier any tier can key on. */
  isSol: boolean;
}

export const DIRECTION_VIA_VALUES = [
  'gaia_5p',
  'gaia_nss_systemic',
  'hip2_saturated',
  'hip2_pm_discrepant',
  'tycho2',
  'cns5',
  'simbad',
  'curated',
] as const;

export type DirectionVia = (typeof DIRECTION_VIA_VALUES)[number];

// Which catalogue supplied the space-motion PM for this row's velocity —
// provenance, not coherence. It maps off the direction tier wherever that tier
// carries a PM; where it does not, `pm-rescue.ts` re-keys on the record's own
// designations and this names whichever catalogue that reached. `zero` is what
// survives both. Pinned per-tier in build-counts.
export const VELOCITY_VIA_VALUES = [
  'gaia_pm',
  'hip2_pm',
  'tycho2_pm',
  'cns5_pm',
  'simbad_pm',
  'zero',
] as const;

export type VelocityVia = (typeof VELOCITY_VIA_VALUES)[number];

/** The astrometric solution one tier selected, before it is advanced to the
 *  scene epoch: position (deg) at the epoch that tier states — per coordinate,
 *  because a Tycho-2 mean solution observes the two over different intervals —
 *  and the PM (mas/yr, cos δ-applied) the same solution carries, if any. Fed
 *  to `directionOnPm` for the position and to `velocityPcPerYr` alongside the
 *  final stack distance + RV, both on whichever motion the row ends up with. */
export interface DirectionSolution {
  srcRaDeg: number;
  srcDecDeg: number;
  srcEpoch: number;
  srcPmraMasyr: number | null;
  srcPmdecMasyr: number | null;
  velVia: VelocityVia;
}

/** A Gaia 5p solution passed over: its PM disagrees with HIP2's (orbit
 *  corruption), or the fit is 2p and HIP2 covers the star. */
export type DirectionRefusal = CascadeRefusal<'gaia_5p', 'pm_disagrees_with_hip2' | 'no_5p_solution'>;

/** `none` is a record no tier states a position for — a /docs/catalog-driver.md#61-record-parity park. */
export type DirectionResolution = CascadeResult<
  UniformValues<DirectionVia, DirectionSolution>,
  DirectionRefusal
>;

/** Sky direction at `toEpoch` for a source measured at `fromEpoch` —
 *  RV-free linear space-motion form (accuracy budget + the
 *  perspective-acceleration omission are in ./README.md#direction-resolution).
 *
 *  `pmraMasyr` is the tier's own μ_α* — the cos δ-applied east-component
 *  rate. Do NOT divide by cos δ before calling. Either PM component
 *  missing → the measured position is returned unpropagated (best
 *  available estimate, matches stage2_resolve.py's convention). */
export function directionAtEpoch(
  raDeg: number,
  decDeg: number,
  pmraMasyr: number | null,
  pmdecMasyr: number | null,
  fromEpoch: number,
  toEpoch: number,
): UnitVector {
  const { u, east, north } = equatorialTangentBasis(raDeg, decDeg);
  if (pmraMasyr === null || pmdecMasyr === null) return u;
  const dEast = pmraMasyr * MAS_TO_RAD * (toEpoch - fromEpoch);
  const dNorth = pmdecMasyr * MAS_TO_RAD * (toEpoch - fromEpoch);
  const x = u.x + dEast * east.x + dNorth * north.x;
  const y = u.y + dEast * east.y + dNorth * north.y;
  const z = u.z + dEast * east.z + dNorth * north.z;
  const norm = Math.hypot(x, y, z);
  return { x: x / norm, y: y / norm, z: z / norm };
}

/** A tier's position advanced to the scene epoch on the motion the row ends up
 *  with — the tier's own where its solution states one, `pm-rescue/`'s where it
 *  does not. The cascade's ONE propagation call site, and the reason
 *  `resolveDirection` returns a solution rather than a direction: only the
 *  caller knows which motion won, and a position advanced on any other is a row
 *  tracking the right rate from the wrong place. Every tier reaching the scene
 *  epoch already (Gaia's J2016.0) is a zero-Δt no-op. */
export function directionOnPm(
  solution: DirectionSolution,
  pmraMasyr: number | null,
  pmdecMasyr: number | null,
): UnitVector {
  return directionAtEpoch(
    solution.srcRaDeg, solution.srcDecDeg, pmraMasyr, pmdecMasyr,
    solution.srcEpoch, CATALOG_SCENE_EPOCH,
  );
}

// 1 km/s in pc/yr: (1 km/s)·(1 Julian yr in s) / (1 pc in km)
//   = 3.15576e7 s / 3.0856775814913673e13 km ≈ 1.0227121651e-6.
export const KM_S_TO_PC_YR = 3.15576e7 / 3.0856775814913673e13;

// Space-velocity sanity ceiling. The Galactic escape velocity near Sol is
// ~530 km/s; the fastest known hypervelocity stars reach ~1700 km/s but none
// is a record here, so a ceiling at 1500 (~3× escape) clamps no real star. A
// computed speed past it is a
// PM×distance artifact — noisy proper motion on a faint distant star, where
// v = d·μ blows a spurious sub-arcsec/yr μ up to thousands of km/s. Such
// rows drop to zero velocity (kept at J2016.0, the same fall-through as
// no-PM rows) rather than streaking across the sky under the epoch-advance.
// Finer per-row PM-S/N filtering is future work.
export const VELOCITY_SANITY_CEILING_KM_S = 1500;
export const VELOCITY_SANITY_CEILING_PC_YR =
  VELOCITY_SANITY_CEILING_KM_S * KM_S_TO_PC_YR;

// Local Galactic escape velocity: Piffl 2014
// (/data/papers/index.md#piffl2014) measure 533 +54/−41 km/s in the Galactic
// rest frame; the threshold here is 550, an open decision
// (README.md#the-escape-speed-threshold-departs-from-its-source). A star
// faster than this is unbound — genuinely exceptional (a handful of proven
// hypervelocity stars Galaxy-wide), so a large above-escape population is
// almost entirely PM×distance / bad-RV artifacts. These rows are NOT
// clamped (a proven escaper must survive); they are counted + logged as a
// tracked ratchet (build-counts `velocityAboveEscape`) so the artifact tail
// is visible and can drive finer per-row PM-S/N + RV-sanity filtering.
export const GALACTIC_ESCAPE_VELOCITY_KM_S = 550;
export const GALACTIC_ESCAPE_VELOCITY_PC_YR =
  GALACTIC_ESCAPE_VELOCITY_KM_S * KM_S_TO_PC_YR;

/** Space-motion velocity in the equatorial Cartesian frame `catalog.bin`
 *  uses, in pc/yr:
 *
 *      v = v_r·û + d·MAS_TO_RAD·(μ_α*·ê + μ_δ·n̂)
 *
 *  `pmraMasyr` is μ_α* (cos δ-applied); do NOT divide by cos δ. `distancePc`
 *  is the final distance-stack output. Missing PM → tangential term zero;
 *  missing RV → radial term zero. See /docs/science-catalog-ingestion.md#current-epoch-star-positions--space-motion-propagation-to-t.
 * */
export function velocityPcPerYr(
  raDeg: number,
  decDeg: number,
  pmraMasyr: number | null,
  pmdecMasyr: number | null,
  distancePc: number,
  rvKmS: number | null,
): UnitVector {
  const { u, east, north } = equatorialTangentBasis(raDeg, decDeg);
  const vr = rvKmS === null ? 0 : rvKmS * KM_S_TO_PC_YR;
  const kEast = pmraMasyr === null ? 0 : pmraMasyr * MAS_TO_RAD * distancePc;
  const kNorth = pmdecMasyr === null ? 0 : pmdecMasyr * MAS_TO_RAD * distancePc;
  return {
    x: vr * u.x + kEast * east.x + kNorth * north.x,
    y: vr * u.y + kEast * east.y + kNorth * north.y,
    z: vr * u.z + kEast * east.z + kNorth * north.z,
  };
}

/** RUWE / ipd_frac_multi_peak orbit-corruption indicators on the 5p fit.
 *  Same pair of gates as stage3_astrometry.py's `gaia_5p_unreliable`. */
export function gaia5pUnreliable(row: GaiaAstrometryCatalogRow): boolean {
  if (row.ruwe !== null && row.ruwe > GAIA_RUWE_UNRELIABLE_THRESHOLD) return true;
  if (
    row.ipdFracMultiPeak !== null
    && row.ipdFracMultiPeak > GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD
  ) return true;
  return false;
}

/** |Δμ| > 50 mas/yr on either axis between the Gaia 5p and HIP2 PMs.
 *  Missing PM on either side → no comparison possible → false. */
export function hip2PmDisagrees(
  gaia: GaiaAstrometryCatalogRow,
  hip2: Hip2AstrometryRow,
): boolean {
  if (
    gaia.pmraMasyr === null || gaia.pmdecMasyr === null
    || hip2.pmRaMasyr === null || hip2.pmDeMasyr === null
  ) return false;
  return (
    Math.abs(gaia.pmraMasyr - hip2.pmRaMasyr) > HIP2_PM_DELTA_THRESHOLD_MASYR
    || Math.abs(gaia.pmdecMasyr - hip2.pmDeMasyr) > HIP2_PM_DELTA_THRESHOLD_MASYR
  );
}

/** The velocity source a tier supplies: its own PM where the solution states
 *  both components, else `zero`. Every tier answers this the same way, so the
 *  tangential term can only go missing for the one stated reason. */
function pmVelVia(
  pmRa: number | null,
  pmDec: number | null,
  via: VelocityVia,
): VelocityVia {
  return pmRa !== null && pmDec !== null ? via : 'zero';
}

/** Select the astrometric solution one spine row's sky direction comes from,
 *  through the trust cascade. Route semantics + priority order in ./README.md#direction-resolution;
 * the Gaia/HIP2 thresholds mirror
 *  scripts/binaries/stage3_astrometry.py.
 *
 *  The solution is NOT advanced here — `directionOnPm` is, once, at the caller,
 *  because the winning motion may be `pm-rescue/`'s rather than this tier's.
 *
 *  `none` only when no tier reaches the row at all. That is a record with no
 *  owned direction, which `/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers` makes a /docs/catalog-driver.md#6-parity--the-gate-on-any-membership-change
 *  membership event rather than a silent keep — the walk parks it as
 *  `no_position`. */
export function resolveDirection(
  { sourceId, hip, tyc, gl, simbad, isSol }: DirectionInputs,
  sources: DirectionSources,
): DirectionResolution {
  const gaia = sourceId !== null
    ? sources.gaiaAstrometry.get(sourceId)
    : undefined;
  const hip2 = hip !== null ? sources.hip2.get(hip) : undefined;
  const refusals: DirectionRefusal[] = [];
  const hit = (via: DirectionVia, value: DirectionSolution): DirectionResolution =>
    ({ via, value, refusals });

  const gaiaSolution = (g: GaiaAstrometryCatalogRow): DirectionSolution => ({
    srcRaDeg: g.raDeg, srcDecDeg: g.decDeg,
    srcEpoch: GAIA_DR3_REF_EPOCH,
    srcPmraMasyr: g.pmraMasyr, srcPmdecMasyr: g.pmdecMasyr,
    velVia: pmVelVia(g.pmraMasyr, g.pmdecMasyr, 'gaia_pm'),
  });
  const hip2Solution = (h: Hip2AstrometryRow): DirectionSolution => ({
    srcRaDeg: h.raDeg, srcDecDeg: h.decDeg,
    srcEpoch: HIP2_REF_EPOCH,
    srcPmraMasyr: h.pmRaMasyr, srcPmdecMasyr: h.pmDeMasyr,
    velVia: pmVelVia(h.pmRaMasyr, h.pmDeMasyr, 'hip2_pm'),
  });

  if (gaia !== undefined && gaiaHas5pSolution(gaia)) {
    if (
      sourceId !== null
      && sources.nss.has(sourceId)
      && gaia5pUnreliable(gaia)
    ) {
      return hit('gaia_nss_systemic', gaiaSolution(gaia));
    }
    if (hip2 !== undefined && hip2PmDisagrees(gaia, hip2)) {
      refusals.push({ tier: 'gaia_5p', reason: 'pm_disagrees_with_hip2' });
      return hit('hip2_pm_discrepant', hip2Solution(hip2));
    }
    return hit('gaia_5p', gaiaSolution(gaia));
  }

  if (hip2 !== undefined) {
    if (gaia !== undefined) refusals.push({ tier: 'gaia_5p', reason: 'no_5p_solution' });
    return hit('hip2_saturated', hip2Solution(hip2));
  }

  // 2p (position-only) Gaia row with no HIP2 cover: keep the Gaia
  // positional anchor, unpropagated when PM is absent — mirrors
  // stage3's gaia_5p fall-through.
  if (gaia !== undefined) return hit('gaia_5p', gaiaSolution(gaia));

  // Designation-joined tiers, for the rows Gaia and HIP2 both miss. Each
  // joins on the record's OWN identifier — a value join, never positional —
  // and each states its own epoch, so a tier supplying the position supplies
  // the proper motion that carries it forward wherever its solution has one.
  const tycho2 = tyc !== null ? sources.tycho2.get(tyc) : undefined;
  if (tycho2 !== undefined) {
    return hit('tycho2', {
      srcRaDeg: tycho2.raDeg, srcDecDeg: tycho2.decDeg,
      srcEpoch: tycho2.epoch,
      srcPmraMasyr: tycho2.pmRaMasyr, srcPmdecMasyr: tycho2.pmDecMasyr,
      velVia: pmVelVia(tycho2.pmRaMasyr, tycho2.pmDecMasyr, 'tycho2_pm'),
    });
  }

  const cns5 = lookupCns5Astrometry(sources.cns5, gl);
  if (cns5 !== null) {
    return hit('cns5', {
      srcRaDeg: cns5.raDeg, srcDecDeg: cns5.decDeg,
      srcEpoch: cns5.posEpoch,
      srcPmraMasyr: cns5.pm?.pmRaMasyr ?? null,
      srcPmdecMasyr: cns5.pm?.pmDecMasyr ?? null,
      velVia: pmVelVia(
        cns5.pm?.pmRaMasyr ?? null, cns5.pm?.pmDecMasyr ?? null, 'cns5_pm',
      ),
    });
  }

  if (simbad !== null) {
    return hit('simbad', {
      srcRaDeg: simbad.raDeg, srcDecDeg: simbad.decDeg,
      srcEpoch: SIMBAD_REF_EPOCH,
      srcPmraMasyr: simbad.pm?.pmRaMasyr ?? null,
      srcPmdecMasyr: simbad.pm?.pmDecMasyr ?? null,
      velVia: pmVelVia(
        simbad.pm?.pmRaMasyr ?? null, simbad.pm?.pmDecMasyr ?? null, 'simbad_pm',
      ),
    });
  }

  // The vector is arbitrary and unobservable: Sol's distance is zero, so the
  // walk multiplies it to the origin whatever it points at.
  if (isSol) {
    return hit('curated', {
      srcRaDeg: 0, srcDecDeg: 0,
      srcEpoch: CATALOG_SCENE_EPOCH,
      srcPmraMasyr: null, srcPmdecMasyr: null,
      velVia: 'zero',
    });
  }

  return { via: 'none', refusals };
}

// ---- TSV parsers ----------------------------------------------------------

const ASTROMETRY_COLUMNS = [
  'source_id', 'ra', 'dec', 'parallax', 'parallax_error', 'pmra', 'pmdec',
  'ruwe', 'ipd_frac_multi_peak', 'phot_g_mean_mag', 'phot_bp_mean_mag',
  'phot_rp_mean_mag', 'radial_velocity', 'radial_velocity_error',
] as const;

type AstrometryRow = TableRow<(typeof ASTROMETRY_COLUMNS)[number]>;

/** source_id stays a string — Gaia IDs exceed Number.MAX_SAFE_INTEGER, so a
 *  numeric parse would corrupt the key. */
function foldAstrometryRow(
  row: AstrometryRow,
  out: Map<string, GaiaAstrometryCatalogRow>,
  from: RowKeyed<string>,
  keep?: ReadonlySet<string>,
): void {
  const sourceId = row.sourceId('source_id');
  if (sourceId === null) return;
  if (keep && !keep.has(sourceId)) return;
  const raDeg = row.float('ra');
  const decDeg = row.float('dec');
  if (raDeg === null || decDeg === null) return;
  out.set(sourceId, {
    raDeg,
    decDeg,
    parallaxMas: row.float('parallax'),
    parallaxErrorMas: row.float('parallax_error'),
    pmraMasyr: row.float('pmra'),
    pmdecMasyr: row.float('pmdec'),
    ruwe: row.float('ruwe'),
    ipdFracMultiPeak: row.float('ipd_frac_multi_peak'),
    gMag: row.float('phot_g_mean_mag'),
    bpMag: row.float('phot_bp_mean_mag'),
    rpMag: row.float('phot_rp_mean_mag'),
    radialVelocityKmS: row.float('radial_velocity'),
    radialVelocityErrorKmS: row.float('radial_velocity_error'),
    ref: sourceRowRef(from, sourceId),
  });
}

/** Line-fed, so a streaming read over the magnitude pull folds rows exactly
 *  as the whole-text parse does. `keep` filters to a subset without holding
 *  the table. */
export function gaiaAstrometryAccumulator(
  from: Declared & RowKeyed<string>,
  keep?: ReadonlySet<string>,
): {
  line: (raw: string) => void;
  result: () => Map<string, GaiaAstrometryCatalogRow>;
} {
  const out = new Map<string, GaiaAstrometryCatalogRow>();
  const spec = { ...from, columns: ASTROMETRY_COLUMNS };
  return {
    line: tableLineReader(spec, (row) => foldAstrometryRow(row, out, from, keep)),
    result: () => out,
  };
}

export function parseGaiaAstrometryCatalogTsv(
  text: string,
  from: Declared & RowKeyed<string>,
): Map<string, GaiaAstrometryCatalogRow> {
  const out = new Map<string, GaiaAstrometryCatalogRow>();
  for (const row of readTable({ ...from, columns: ASTROMETRY_COLUMNS }, text)) foldAstrometryRow(row, out, from);
  return out;
}

const HIP2_COLUMNS = ['hip', 'ra_icrs', 'de_icrs', 'plx', 'e_plx', 'pm_ra', 'pm_de'] as const;

/** `hips` is every HIP the table publishes, positioned or not — what the
 *  primaries audit attests a cell against. */
export interface Hip2Table {
  astrometry: Map<number, Hip2AstrometryRow>;
  hips: Set<number>;
}

export function parseHip2Tsv(text: string, from: Declared & RowKeyed<number>): Hip2Table {
  const out = new Map<number, Hip2AstrometryRow>();
  const hips = new Set<number>();
  for (const row of readTable({ ...from, columns: HIP2_COLUMNS }, text)) {
    const hip = row.int('hip');
    if (hip !== null) hips.add(hip);
    if (hip === null || hip <= 0) continue;
    const raDeg = row.float('ra_icrs');
    const decDeg = row.float('de_icrs');
    if (raDeg === null || decDeg === null) continue;
    out.set(hip, {
      raDeg,
      decDeg,
      plxMas: row.float('plx'),
      plxErrorMas: row.float('e_plx'),
      pmRaMasyr: row.float('pm_ra'),
      pmDeMasyr: row.float('pm_de'),
      ref: sourceRowRef(from, hip),
    });
  }
  return { astrometry: out, hips };
}

const GAIA_NSS_COLUMNS = ['source_id'] as const;

/** Only the first column is read — membership is the only signal the cascade needs. */
export function parseNssIndex(
  text: string, from: Declared & RowKeyed<string>,
): Map<string, SourceRowRef<string>> {
  const out = new Map<string, SourceRowRef<string>>();
  for (const row of readTable({ ...from, columns: GAIA_NSS_COLUMNS }, text)) {
    const sourceId = row.sourceId('source_id');
    if (sourceId !== null) out.set(sourceId, sourceRowRef(from, sourceId));
  }
  return out;
}
