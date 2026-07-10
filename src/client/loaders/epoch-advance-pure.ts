// Load-time space-motion propagation of catalog positions off their fixed
// J2016.0 baseline to the scene's time base. See SCIENCE.md § Current-epoch
// star positions and scripts/catalog/README.md § Space-motion velocity.

// catalog.bin positions ship at this fixed scene epoch (Julian year);
// velocities are pc/yr, so the advance is p(t) = p(J2016) + v·(t − 2016).
// Mirrors CATALOG_SCENE_EPOCH in scripts/catalog/direction-cascade.ts.
export const CATALOG_SCENE_EPOCH_JYR = 2016.0;

const J2000_JD = 2451545.0;
const JULIAN_YEAR_DAYS = 365.25;

/** Julian Date → Julian epoch year (e.g. 2451545.0 → 2000.0). The time
 *  base the linear space-motion propagation runs in. */
export function jdeToJulianEpochYear(jde: number): number {
  return 2000.0 + (jde - J2000_JD) / JULIAN_YEAR_DAYS;
}

/** Advance `positions` in place to `epochJyr`:
 *  `p(t) = p(J2016) + v·(t − 2016)`, computed in float64, written back to
 *  the float32 buffer. `positions` and `velocities` are the flat
 *  `count × 3` equatorial-Cartesian buffers (pc and pc/yr). Idempotent only
 *  in that it must be called ONCE against the J2016.0 baseline — re-running
 *  would double-advance (there is no re-advance machinery in v1; scrubber-
 *  time re-advance is deferred). A zero Δt is a no-op. */
export function advancePositionsToEpoch(
  positions: Float32Array,
  velocities: Float32Array,
  epochJyr: number,
): void {
  const dt = epochJyr - CATALOG_SCENE_EPOCH_JYR;
  if (dt === 0) return;
  const n = positions.length;
  for (let i = 0; i < n; i++) {
    positions[i] = positions[i] + velocities[i] * dt;
  }
}
