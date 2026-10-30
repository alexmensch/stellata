// The distance-override layers: Bailer-Jones eligibility and lookup, and the LMC kinematic snap. See README.md.

import type { DistVia } from '../parallax/parallax-cascade';
import { parallaxSignalToNoise, type MeasuredParallax } from '../../cited-parallax';
import { sourceRowRef, type SourceRowRef } from '../../../util/sources/row-ref-pure';
import { BAILER_JONES } from './bailer-jones-source';

/** Whether a record is eligible for the Bailer-Jones override: it resolves to a
 *  Gaia DR3 source_id AND the parallax its own cascade settled on is Gaia's.
 *
 *  B-J publishes a Bayesian posterior over a Gaia parallax, so it may only
 *  supersede that same parallax. Applied to a record whose distance rests on
 *  Hipparcos, CNS5 or Gliese instead, it would discard a measurement and
 *  substitute a posterior computed from a different, worse one, moving stars
 *  onto the Galactic-density prior tail at ~10–40 kpc. The predicate is the
 *  first-hand parallax tier, never an inherited editorial cell
 *  (`/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers`). */
export function isBailerJonesEligible(
  gaiaSourceId: string | null,
  distVia: DistVia,
): boolean {
  return !!gaiaSourceId && distVia === 'gaia_dr3_inversion';
}

/** The posterior distance in parsecs, B-J's own unit.
 *
 *  Every distance-override layer (Bailer-Jones, LMC kinematic, and future SMC
 *  kinematic / structural-disc / OGLE Cepheid layers) returns a bare distance:
 *  absmag is derived once from the V cascade and the distance the whole stack
 *  settled on (`../../photometry/README.md#the-v-cascade`), so a layer cannot
 *  place a star at a new distance while lighting it for the old one. xyz is
 *  likewise not a layer's business — position is direction × distance, with
 *  the direction resolved independently by the direction cascade. */
export function applyBailerJonesOverride(
  gaiaSourceId: string | null,
  bjMap: Map<string, number>,
): { distPc: number; ref: SourceRowRef<string> } | null {
  if (!gaiaSourceId) return null;
  const distPc = bjMap.get(gaiaSourceId);
  return distPc === undefined ? null : { distPc, ref: sourceRowRef(BAILER_JONES, gaiaSourceId) };
}

// ---- LMC kinematic distance override -------------------------------------

// LMC kinematic parameters. References:
//   - Pietrzyński 2019 (/data/papers/index.md#pietrzynski2019):
//     eclipsing-binary distance 49.59 kpc, ± 0.09 statistical ± 0.54
//     systematic (shipped as 49.594, an open decision:
//     /scripts/catalog/distance/refinement/README.md#layer-2--lmc-kinematic-override).
//   - van der Marel 2014 (/data/papers/index.md#vandermarel2014):
//     PM dynamical centre (RA, Dec) = (78.76°, −69.19°)
//     = (05h 15m 02s, −69° 11′ 24″) — their PM-field fit, not the NED/SIMBAD
//     photometric centre (05h 23m 34s, −69° 45′). Same paper's centre-of-mass
//     bulk PM: μ_α* = +1.910 ± 0.020, μ_δ = +0.229 ± 0.047 mas/yr. The gate centre below (1.85, 0.20) is a
//     rounded working value toward the field-mean (centroid) PM — the
//     COM−gate difference (≤ 0.07 mas/yr) and the disc's internal-rotation
//     spread (±0.3 mas/yr) both sit well inside the ±0.5 tolerance.
//   - The 15° cone is wide enough to admit the visible disc and
//     30 Doradus while keeping confusion with Galactic foreground low.
// Tolerances chosen so Galactic halo / runaway stars in the same sky region
// (which have very different PMs) fail the test — see catalog-pure.test.ts.
export const LMC_DISTANCE_PC = 49_594;
export const LMC_CENTRE_RA_HOURS = 5.25067;       // 78.76° / 15
export const LMC_CENTRE_DEC_DEG = -69.19;
export const LMC_CONE_HALF_ANGLE_DEG = 15;
export const LMC_PM_RA_CENTRE = 1.85;             // mas/yr
export const LMC_PM_DEC_CENTRE = 0.20;            // mas/yr
export const LMC_PM_TOLERANCE = 0.5;              // mas/yr per component

/** Angular separation (degrees) between two ICRS positions. Vector
 *  dot-product form — stable for small and wide separations alike, no
 *  cos/sin of differences. Input RA is hours, Dec is degrees. */
export function angularSeparationDeg(
  raHoursA: number,
  decDegA: number,
  raHoursB: number,
  decDegB: number,
): number {
  const raA = raHoursA * (Math.PI / 12);
  const raB = raHoursB * (Math.PI / 12);
  const decA = decDegA * (Math.PI / 180);
  const decB = decDegB * (Math.PI / 180);
  const cosDecA = Math.cos(decA);
  const cosDecB = Math.cos(decB);
  const ax = cosDecA * Math.cos(raA);
  const ay = cosDecA * Math.sin(raA);
  const az = Math.sin(decA);
  const bx = cosDecB * Math.cos(raB);
  const by = cosDecB * Math.sin(raB);
  const bz = Math.sin(decB);
  const dot = Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz));
  return Math.acos(dot) * (180 / Math.PI);
}

/** Whether (raHours, decDegrees) falls within the LMC sky cone — the
 *  population predicate behind the `lmcCandidates` build-counter. */
export function isInLmcCone(raHours: number, decDegrees: number): boolean {
  const sep = angularSeparationDeg(
    raHours, decDegrees,
    LMC_CENTRE_RA_HOURS, LMC_CENTRE_DEC_DEG,
  );
  return sep <= LMC_CONE_HALF_ANGLE_DEG;
}

export const LMC_PARALLAX_MAS = 1000 / LMC_DISTANCE_PC;

/** Measured, not chosen: `README.md#layer-2--lmc-kinematic-override`. */
export const LMC_PARALLAX_CONSISTENCY_SIGMA = 10;

export type LmcKinematicVerdict =
  | { kind: 'snap'; distPc: number }
  | { kind: 'parallax_rules_out' }
  | { kind: 'not_member' };

/** Every gate is evaluated here, so no caller can produce an override by
 *  forgetting one. */
export function applyLmcKinematicOverride(
  raHours: number,
  decDegrees: number,
  pmRa: number | null,
  pmDec: number | null,
  parallax: MeasuredParallax | null,
): LmcKinematicVerdict {
  if (pmRa === null || pmDec === null) return { kind: 'not_member' };
  if (!isInLmcCone(raHours, decDegrees)) return { kind: 'not_member' };
  if (Math.abs(pmRa - LMC_PM_RA_CENTRE) > LMC_PM_TOLERANCE) return { kind: 'not_member' };
  if (Math.abs(pmDec - LMC_PM_DEC_CENTRE) > LMC_PM_TOLERANCE) return { kind: 'not_member' };
  const sigmaAboveLmc = parallax === null
    ? null
    : parallaxSignalToNoise(parallax.mas - LMC_PARALLAX_MAS, parallax.errMas);
  if (sigmaAboveLmc !== null && sigmaAboveLmc > LMC_PARALLAX_CONSISTENCY_SIGMA) {
    return { kind: 'parallax_rules_out' };
  }
  return { kind: 'snap', distPc: LMC_DISTANCE_PC };
}
