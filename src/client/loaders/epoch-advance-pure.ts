// Space-motion propagation of catalog positions off their fixed J2016.0
// baseline to the scene's time base. See docs/science-catalog-ingestion.md
// § Current-epoch star positions.

import { DAYS_PER_JULIAN_YEAR, J2000_JD } from '../util/astronomy-constants';

// catalog.bin positions ship at this fixed scene epoch (Julian year);
// velocities are pc/yr, so the advance is p(t) = p(J2016) + v·(t − 2016).
// Mirrors CATALOG_SCENE_EPOCH in scripts/catalog/distance/direction-cascade.ts.
export const CATALOG_SCENE_EPOCH_JYR = 2016.0;

/** Julian Date → Julian epoch year (e.g. 2451545.0 → 2000.0). The time
 *  base the linear space-motion propagation runs in. */
export function jdeToJulianEpochYear(jde: number): number {
  return 2000.0 + (jde - J2000_JD) / DAYS_PER_JULIAN_YEAR;
}

// Advance-epoch quantum: 1/20 Julian year. The worst catalog proper motion
// (Barnard's Star, ~10.4″/yr) drifts ~0.5″ per bucket — sub-pixel at the
// tightest observe-mode FOV — so re-running the advance only on bucket
// crossings is visually lossless while a scrub is in flight. Integer
// buckets-per-year keeps the grid float64-exact (n/20 round-trips; n×0.05
// does not).
const READVANCE_BUCKETS_PER_JYR = 20;
export const READVANCE_BUCKET_JYR = 1 / READVANCE_BUCKETS_PER_JYR;

/** Quantise an epoch onto the re-advance bucket grid. Same `t` always
 *  lands on the same bucket, so advanced positions are reproducible
 *  across sessions and URL restores. */
export function bucketEpochJyr(epochJyr: number): number {
  return Math.round(epochJyr * READVANCE_BUCKETS_PER_JYR) / READVANCE_BUCKETS_PER_JYR;
}

/** Advance star positions to `epochJyr`:
 *  `out = base + v·(t − 2016)`, computed in float64, written back to the
 *  float32 buffer. `basePositions` must hold the pristine J2016.0 catalog
 *  baseline and is never written when a distinct `outPositions` is given —
 *  keeping it immutable is what makes every re-advance an idempotent
 *  function of `epochJyr` alone. The single-buffer form (out defaulted to
 *  base) is only valid ONCE against the J2016.0 baseline. */
export function advancePositionsToEpoch(
  basePositions: Float32Array,
  velocities: Float32Array,
  epochJyr: number,
  outPositions: Float32Array = basePositions,
): void {
  const dt = epochJyr - CATALOG_SCENE_EPOCH_JYR;
  const n = basePositions.length;
  if (dt === 0) {
    if (outPositions !== basePositions) outPositions.set(basePositions);
    return;
  }
  for (let i = 0; i < n; i++) {
    outPositions[i] = basePositions[i] + velocities[i] * dt;
  }
}

/** Write star `i3` (its ×3 flat offset) into `localOut` at the local-frame
 *  position for epoch `epochJyr`, formed in float64 as
 *  `(base + v·Δt) − origin`. Doing the origin subtraction on the un-rounded
 *  float64 advance — rather than on the float32 absolute — keeps the
 *  systemic drift at full precision: the float32 absolute ULP is ~0.4 AU at
 *  28 pc, coarser than a tight binary orbit, so subtracting the origin from
 *  the rounded absolute snaps a drifting system onto that grid frame to
 *  frame. `BinaryOrbitField`'s per-frame baseline reset uses this so a
 *  drifting pair doesn't teleport under time scrub. */
export function writeAdvancedLocal(
  basePositions: Float32Array,
  velocities: Float32Array,
  epochJyr: number,
  i3: number,
  ox: number,
  oy: number,
  oz: number,
  localOut: Float32Array,
): void {
  const dt = epochJyr - CATALOG_SCENE_EPOCH_JYR;
  localOut[i3] = basePositions[i3] + velocities[i3] * dt - ox;
  localOut[i3 + 1] = basePositions[i3 + 1] + velocities[i3 + 1] * dt - oy;
  localOut[i3 + 2] = basePositions[i3 + 2] + velocities[i3 + 2] * dt - oz;
}

/** Largest space-motion speed (pc/yr) in a flat `count × 3` velocity
 *  buffer. Bounds how far any star can drift from its load-epoch
 *  position over the scrubbable range. */
export function maxSpeedPcPerYr(velocities: Float32Array): number {
  let maxSq = 0;
  for (let i = 0; i < velocities.length; i += 3) {
    const vx = velocities[i];
    const vy = velocities[i + 1];
    const vz = velocities[i + 2];
    const sq = vx * vx + vy * vy + vz * vz;
    if (sq > maxSq) maxSq = sq;
  }
  return Math.sqrt(maxSq);
}
