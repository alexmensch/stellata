// Space-motion velocity: the pc/yr assembly, its unit conversions and sanity
// thresholds, and which catalogue supplied the proper motion.

import { equatorialTangentBasis, type UnitVector } from '../../../src/astro-core/equatorial-basis';
import {
  DAYS_PER_JULIAN_YEAR, KM_PC, MAS_TO_RAD, SECONDS_PER_DAY,
} from '../../../src/astro-core/astronomy-constants';

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

export const KM_S_TO_PC_YR = KM_PC * DAYS_PER_JULIAN_YEAR * SECONDS_PER_DAY;

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
