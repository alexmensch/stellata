// Per-row sky-direction resolution for the catalog build: Gaia DR3 5p →
// HIP2 → Tycho-2 → CNS5 → SIMBAD, with proper-motion propagation to the
// J2016.0 scene epoch. See ./README.md § Direction resolution.

import {
  equatorialTangentBasis,
  type UnitVector,
} from '../../../src/client/util/equatorial-basis';
import { headerIndex } from '../parse/corpus-tsv';
import { gaiaHas5pSolution } from './gaia-distrust';
import type { SimbadRecordKeys } from '../catalog-pure';
import type { Tycho2Row } from '../tycho2-parse';
import {
  lookupCns5Astrometry,
  type Cns5Astrometry,
} from '../classic-ids/classic-ids-parse';
import type { SimbadAstrometry } from '../simbad-values-parse';

export const GAIA_DR3_REF_EPOCH = 2016.0;
export const HIP2_REF_EPOCH = 1991.25;
/** SIMBAD states `basic.ra` / `basic.dec` at J2000.0 whatever epoch the
 *  citation measured them at. The pull carries no epoch column, so this is
 *  measured rather than assumed — README.md § Direction resolution. */
export const SIMBAD_REF_EPOCH = 2000.0;
// Gaia DR3's native epoch: the catalogue-wide scene epoch every position
// is normalised onto. The dominant Gaia set lands here with zero
// propagation; only the HIP2 / Tycho-2 / CNS5 / SIMBAD minority advances.
// The binaries pipeline mirrors this in scripts/binaries/stage6_multiples.py
// — keep the two in sync (see data/README.md § Reference epoch and proper
// motion).
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
}

/** van Leeuwen 2007 reduction row from
 *  `data/hipparcos/hip2_van_leeuwen.tsv`. ra/dec are at J1991.25. */
export interface Hip2AstrometryRow {
  raDeg: number;
  decDeg: number;
  plxMas: number | null;
  plxErrorMas: number | null;
  pmRaMasyr: number | null;
  pmDeMasyr: number | null;
}

/** The reference datasets this cascade routes between. It is not their only
 *  reader — `gaiaAstrometry` also carries the photometry the V and ci cascades
 *  transform and the rv the radial term takes, and `tycho2` the BT/VT the V
 *  cascade reduces — so a column added for one cascade arrives for all of
 *  them, and the bundle is named for the cascade that ROUTES on it rather than
 *  for sole ownership.
 *
 *  Empty maps/sets degrade gracefully: a row whose every tier is absent
 *  resolves to null, which the walk counts as `spineDroppedNoDirection` —
 *  pinned at 0, so the drift fails the build by name rather than dropping a
 *  record quietly. */
export interface DirectionSources {
  gaiaAstrometry: Map<string, GaiaAstrometryCatalogRow>;
  hip2: Map<number, Hip2AstrometryRow>;
  nssSourceIds: Set<string>;
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
  via: DirectionVia;
  srcRaDeg: number;
  srcDecDeg: number;
  srcEpochRa: number;
  srcEpochDec: number;
  srcPmraMasyr: number | null;
  srcPmdecMasyr: number | null;
  velVia: VelocityVia;
}

/** Sky direction at `toEpoch` for a source measured at `fromEpoch` —
 *  RV-free linear space-motion form (accuracy budget + the
 *  perspective-acceleration omission are in ./README.md
 *  § Direction resolution).
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
  return directionAtEpochSplit(
    raDeg, decDeg, pmraMasyr, pmdecMasyr, fromEpoch, fromEpoch, toEpoch,
  );
}

/** {@link directionAtEpoch} where the two coordinates are measured at
 *  DIFFERENT epochs, so each advances over its own interval — the Tycho-2
 *  tier's shape, and the only one that needs it (./README.md § Every tier
 *  states its own epoch, and one of them states two). Every tier reaches this
 *  form through `directionOnPm`, which passes a solution's own pair — the same
 *  epoch twice where the tier states only one. */
export function directionAtEpochSplit(
  raDeg: number,
  decDeg: number,
  pmraMasyr: number | null,
  pmdecMasyr: number | null,
  fromEpochRa: number,
  fromEpochDec: number,
  toEpoch: number,
): UnitVector {
  const { u, east, north } = equatorialTangentBasis(raDeg, decDeg);
  if (pmraMasyr === null || pmdecMasyr === null) return u;
  const dEast = pmraMasyr * MAS_TO_RAD * (toEpoch - fromEpochRa);
  const dNorth = pmdecMasyr * MAS_TO_RAD * (toEpoch - fromEpochDec);
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
  return directionAtEpochSplit(
    solution.srcRaDeg, solution.srcDecDeg, pmraMasyr, pmdecMasyr,
    solution.srcEpochRa, solution.srcEpochDec, CATALOG_SCENE_EPOCH,
  );
}

// 1 km/s in pc/yr: (1 km/s)·(1 Julian yr in s) / (1 pc in km)
//   = 3.15576e7 s / 3.0856775814913673e13 km ≈ 1.0227121651e-6.
export const KM_S_TO_PC_YR = 3.15576e7 / 3.0856775814913673e13;

// Space-velocity sanity ceiling. The Galactic escape velocity near Sol is
// ~550 km/s; the fastest known hypervelocity stars reach ~1700 km/s but are
// absent from this bright classic-IDs subset, so a ceiling at 1500 (~3×
// escape) clamps no real star here. A computed speed past it is a
// PM×distance artifact — noisy proper motion on a faint distant star, where
// v = d·μ blows a spurious sub-arcsec/yr μ up to thousands of km/s. Such
// rows drop to zero velocity (kept at J2016.0, the same fall-through as
// no-PM rows) rather than streaking across the sky under the epoch-advance.
// Finer per-row PM-S/N filtering is future work.
export const VELOCITY_SANITY_CEILING_KM_S = 1500;
export const VELOCITY_SANITY_CEILING_PC_YR =
  VELOCITY_SANITY_CEILING_KM_S * KM_S_TO_PC_YR;

// Local Galactic escape velocity (~550 km/s, Piffl et al. 2014). A star
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
 *  missing RV → radial term zero. See docs/science-catalog-ingestion.md
 *  § Current-epoch star positions. */
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
 *  through the trust cascade. Route semantics + priority order in ./README.md
 *  § Direction resolution; the Gaia/HIP2 thresholds mirror
 *  scripts/binaries/stage3_astrometry.py.
 *
 *  The solution is NOT advanced here — `directionOnPm` is, once, at the caller,
 *  because the winning motion may be `pm-rescue/`'s rather than this tier's.
 *
 *  Returns null only when no tier reaches the row at all. That is a record
 *  with no owned direction, which `docs/catalog-driver.md` § 5 makes a § 6
 *  membership event rather than a silent keep — the walk counts it as
 *  `spineDroppedNoDirection`, pinned at 0. */
export function resolveDirection(
  { sourceId, hip, tyc, gl, simbad, isSol }: DirectionInputs,
  sources: DirectionSources,
): DirectionSolution | null {
  const gaia = sourceId !== null
    ? sources.gaiaAstrometry.get(sourceId)
    : undefined;
  const hip2 = hip !== null ? sources.hip2.get(hip) : undefined;

  const gaiaSolution = (via: DirectionVia, g: GaiaAstrometryCatalogRow): DirectionSolution => ({
    via,
    srcRaDeg: g.raDeg, srcDecDeg: g.decDeg,
    srcEpochRa: GAIA_DR3_REF_EPOCH, srcEpochDec: GAIA_DR3_REF_EPOCH,
    srcPmraMasyr: g.pmraMasyr, srcPmdecMasyr: g.pmdecMasyr,
    velVia: pmVelVia(g.pmraMasyr, g.pmdecMasyr, 'gaia_pm'),
  });
  const hip2Solution = (via: DirectionVia, h: Hip2AstrometryRow): DirectionSolution => ({
    via,
    srcRaDeg: h.raDeg, srcDecDeg: h.decDeg,
    srcEpochRa: HIP2_REF_EPOCH, srcEpochDec: HIP2_REF_EPOCH,
    srcPmraMasyr: h.pmRaMasyr, srcPmdecMasyr: h.pmDeMasyr,
    velVia: pmVelVia(h.pmRaMasyr, h.pmDeMasyr, 'hip2_pm'),
  });

  if (gaia !== undefined && gaiaHas5pSolution(gaia)) {
    if (
      sourceId !== null
      && sources.nssSourceIds.has(sourceId)
      && gaia5pUnreliable(gaia)
    ) {
      return gaiaSolution('gaia_nss_systemic', gaia);
    }
    if (hip2 !== undefined && hip2PmDisagrees(gaia, hip2)) {
      return hip2Solution('hip2_pm_discrepant', hip2);
    }
    return gaiaSolution('gaia_5p', gaia);
  }

  if (hip2 !== undefined) return hip2Solution('hip2_saturated', hip2);

  // 2p (position-only) Gaia row with no HIP2 cover: keep the Gaia
  // positional anchor, unpropagated when PM is absent — mirrors
  // stage3's gaia_5p fall-through.
  if (gaia !== undefined) return gaiaSolution('gaia_5p', gaia);

  // Designation-joined tiers, for the rows Gaia and HIP2 both miss. Each
  // joins on the record's OWN identifier — a value join, never positional —
  // and each states its own epoch, so a tier supplying the position supplies
  // the proper motion that carries it forward wherever its solution has one.
  const tycho2 = tyc !== null ? sources.tycho2.get(tyc) : undefined;
  if (tycho2 !== undefined) {
    return {
      via: 'tycho2',
      srcRaDeg: tycho2.raDeg, srcDecDeg: tycho2.decDeg,
      srcEpochRa: tycho2.epochRa, srcEpochDec: tycho2.epochDec,
      srcPmraMasyr: tycho2.pmRaMasyr, srcPmdecMasyr: tycho2.pmDecMasyr,
      velVia: pmVelVia(tycho2.pmRaMasyr, tycho2.pmDecMasyr, 'tycho2_pm'),
    };
  }

  const cns5 = lookupCns5Astrometry(sources.cns5, gl);
  if (cns5 !== null) {
    return {
      via: 'cns5',
      srcRaDeg: cns5.raDeg, srcDecDeg: cns5.decDeg,
      srcEpochRa: cns5.posEpoch, srcEpochDec: cns5.posEpoch,
      srcPmraMasyr: cns5.pm?.pmRaMasyr ?? null,
      srcPmdecMasyr: cns5.pm?.pmDecMasyr ?? null,
      velVia: pmVelVia(
        cns5.pm?.pmRaMasyr ?? null, cns5.pm?.pmDecMasyr ?? null, 'cns5_pm',
      ),
    };
  }

  if (simbad !== null) {
    return {
      via: 'simbad',
      srcRaDeg: simbad.raDeg, srcDecDeg: simbad.decDeg,
      srcEpochRa: SIMBAD_REF_EPOCH, srcEpochDec: SIMBAD_REF_EPOCH,
      srcPmraMasyr: simbad.pm?.pmRaMasyr ?? null,
      srcPmdecMasyr: simbad.pm?.pmDecMasyr ?? null,
      velVia: pmVelVia(
        simbad.pm?.pmRaMasyr ?? null, simbad.pm?.pmDecMasyr ?? null, 'simbad_pm',
      ),
    };
  }

  // Sol carries no source_id, HIP, TYC or GJ, so every tier above misses it
  // and it would otherwise leave the cascade with no direction and be dropped.
  // The vector is arbitrary and unobservable: Sol's distance is zero, so the
  // walk multiplies it to the origin whatever it points at.
  if (isSol) {
    return {
      via: 'curated',
      srcRaDeg: 0, srcDecDeg: 0,
      srcEpochRa: CATALOG_SCENE_EPOCH, srcEpochDec: CATALOG_SCENE_EPOCH,
      srcPmraMasyr: null, srcPmdecMasyr: null,
      velVia: 'zero',
    };
  }

  return null;
}

// ---- TSV parsers ----------------------------------------------------------

function floatCell(cells: string[], i: number): number | null {
  const s = (cells[i] ?? '').trim();
  if (!s) return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

/** Parse `data/gaia/gaia_dr3_astrometry_catalog.tsv` into a source_id →
 *  row map. source_id stays a string — Gaia IDs exceed
 *  Number.MAX_SAFE_INTEGER, so a numeric parse would corrupt the key. */
export function parseGaiaAstrometryCatalogTsv(
  text: string,
): Map<string, GaiaAstrometryCatalogRow> {
  const out = new Map<string, GaiaAstrometryCatalogRow>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const idx = headerIndex(
    lines[0],
    ['source_id', 'ra', 'dec', 'parallax', 'parallax_error', 'pmra', 'pmdec', 'ruwe', 'ipd_frac_multi_peak', 'phot_g_mean_mag', 'phot_bp_mean_mag', 'phot_rp_mean_mag', 'radial_velocity', 'radial_velocity_error'],
    'Gaia astrometry catalog TSV',
    'Re-run scripts/refresh/refresh-gaia-astrometry-catalog.py.',
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const sourceId = (cells[idx.source_id] ?? '').trim();
    if (!sourceId) continue;
    const raDeg = floatCell(cells, idx.ra);
    const decDeg = floatCell(cells, idx.dec);
    if (raDeg === null || decDeg === null) continue;
    out.set(sourceId, {
      raDeg,
      decDeg,
      parallaxMas: floatCell(cells, idx.parallax),
      parallaxErrorMas: floatCell(cells, idx.parallax_error),
      pmraMasyr: floatCell(cells, idx.pmra),
      pmdecMasyr: floatCell(cells, idx.pmdec),
      ruwe: floatCell(cells, idx.ruwe),
      ipdFracMultiPeak: floatCell(cells, idx.ipd_frac_multi_peak),
      gMag: floatCell(cells, idx.phot_g_mean_mag),
      bpMag: floatCell(cells, idx.phot_bp_mean_mag),
      rpMag: floatCell(cells, idx.phot_rp_mean_mag),
      radialVelocityKmS: floatCell(cells, idx.radial_velocity),
      radialVelocityErrorKmS: floatCell(cells, idx.radial_velocity_error),
    });
  }
  return out;
}

/** Parse `data/hipparcos/hip2_van_leeuwen.tsv` into a HIP →
 *  Hip2AstrometryRow map. */
export function parseHip2Tsv(text: string): Map<number, Hip2AstrometryRow> {
  const out = new Map<number, Hip2AstrometryRow>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const idx = headerIndex(
    lines[0],
    ['hip', 'ra_icrs', 'de_icrs', 'plx', 'e_plx', 'pm_ra', 'pm_de'],
    'HIP2 van Leeuwen TSV',
    'Restore data/hipparcos/hip2_van_leeuwen.tsv from LFS.',
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const hip = Number((cells[idx.hip] ?? '').trim());
    if (!Number.isInteger(hip) || hip <= 0) continue;
    const raDeg = floatCell(cells, idx.ra_icrs);
    const decDeg = floatCell(cells, idx.de_icrs);
    if (raDeg === null || decDeg === null) continue;
    out.set(hip, {
      raDeg,
      decDeg,
      plxMas: floatCell(cells, idx.plx),
      plxErrorMas: floatCell(cells, idx.e_plx),
      pmRaMasyr: floatCell(cells, idx.pm_ra),
      pmDeMasyr: floatCell(cells, idx.pm_de),
    });
  }
  return out;
}

/** Extract the set of Gaia DR3 source_ids carrying an NSS two-body
 *  orbit from `data/gaia/gaia_dr3_nss_two_body.tsv`. Only the first
 *  column is read — membership is the only signal the cascade needs. */
export function parseNssSourceIdSet(text: string): Set<string> {
  const out = new Set<string>();
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return out;
  const idx = headerIndex(
    lines[0],
    ['source_id'],
    'Gaia NSS two-body TSV',
    'Re-run scripts/refresh/refresh-gaia-nss.py.',
  );
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const sourceId = (line.split('\t')[idx.source_id] ?? '').trim();
    if (sourceId) out.add(sourceId);
  }
  return out;
}
