// Per-row sky-direction resolution for the catalog build: Gaia DR3 5p →
// HIP2 → Tycho-2 → CNS5 → SIMBAD, with proper-motion propagation to the
// J2016.0 scene epoch. See ./README.md#direction-resolution.

import {
  equatorialTangentBasis,
  type UnitVector,
} from '../../../src/astro-core/equatorial-basis';
import { gaiaHas5pSolution } from './gaia-distrust';
import { MAS_TO_RAD, type VelocityVia } from './velocity';
import type { SimbadRecordKeys } from '../simbad/simbad-namespace-ladder-pure';
import type { Tycho2Row } from '../tycho2-parse';
import type { AnySourceRowRef, SourceRowRef } from '../../util/sources/row-ref-pure';
import type { GaiaAstrometryCatalogRow } from '../sources/gaia-astrometry-source';
import type { Hip2AstrometryRow } from '../sources/hip2-source';
import {
  lookupCns5Astrometry,
  type Cns5Astrometry,
} from '../classic-ids/classic-ids-parse';
import type { SimbadAstrometry } from '../simbad/simbad-values-parse';
import type { CitedCascadeResult, CitedRefusal, UniformValues } from '../cascade-result';

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
  'gaia_2p',
  'gaia_nss_systemic',
  'hip2_saturated',
  'hip2_pm_discrepant',
  'tycho2',
  'cns5',
  'simbad',
  'curated',
] as const;

export type DirectionVia = (typeof DIRECTION_VIA_VALUES)[number];

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
export type DirectionRefusal = CitedRefusal<'gaia_5p', 'pm_disagrees_with_hip2' | 'no_5p_solution'>;

/** `none` is a record no tier states a position for — a /docs/catalog-driver.md#61-record-parity park. */
export type DirectionResolution = CitedCascadeResult<
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
  const hit = (
    via: DirectionVia, value: DirectionSolution, evidence: readonly AnySourceRowRef[],
  ): DirectionResolution => ({ via, value, evidence, refusals });

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
    const nss = sourceId !== null ? sources.nss.get(sourceId) : undefined;
    if (nss !== undefined && gaia5pUnreliable(gaia)) {
      return hit('gaia_nss_systemic', gaiaSolution(gaia), [gaia.ref, nss]);
    }
    if (hip2 !== undefined && hip2PmDisagrees(gaia, hip2)) {
      refusals.push({ tier: 'gaia_5p', reason: 'pm_disagrees_with_hip2', ref: gaia.ref });
      return hit('hip2_pm_discrepant', hip2Solution(hip2), [hip2.ref]);
    }
    return hit('gaia_5p', gaiaSolution(gaia), [gaia.ref]);
  }

  if (hip2 !== undefined) {
    if (gaia !== undefined) refusals.push({ tier: 'gaia_5p', reason: 'no_5p_solution', ref: gaia.ref });
    return hit('hip2_saturated', hip2Solution(hip2), [hip2.ref]);
  }

  // 2p (position-only) Gaia row with no HIP2 cover: keep the Gaia
  // positional anchor, unpropagated when PM is absent — mirrors
  // stage3's gaia_5p fall-through.
  if (gaia !== undefined) return hit('gaia_2p', gaiaSolution(gaia), [gaia.ref]);

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
    }, [tycho2.ref]);
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
    }, [cns5.ref]);
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
    }, [simbad.ref]);
  }

  // The vector is arbitrary and unobservable: Sol's distance is zero, so the
  // walk multiplies it to the origin whatever it points at.
  if (isSol) {
    return hit('curated', {
      srcRaDeg: 0, srcDecDeg: 0,
      srcEpoch: CATALOG_SCENE_EPOCH,
      srcPmraMasyr: null, srcPmdecMasyr: null,
      velVia: 'zero',
    }, []);
  }

  return { via: 'none', refusals };
}
