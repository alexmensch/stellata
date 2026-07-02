// Simulation time `t` (Unix-seconds double) + UTC ↔ Julian-day helpers.
// See src/client/solar-system/README.md § Time.

// Julian Date of the Unix epoch (1970-01-01T00:00:00Z). Subtracting
// from any JD gives Unix-seconds × 86400.
const UNIX_EPOCH_JD = 2440587.5;

// Tolerance (seconds) under which a value of `t` is considered "live"
// — i.e. tracking wall-clock now rather than a scrubber-pinned point.
// Driven by the readout to label "Live" vs an
// explicit timestamp; small enough that the per-second tick still
// reads as live, large enough to absorb scheduler jitter.
const LIVE_TOLERANCE_SEC = 1;

/** Unix-seconds → Julian Date (TDB scale, accurate enough for VSOP87D). */
export function tToJDE(t: number): number {
  return t / 86400 + UNIX_EPOCH_JD;
}

/** Julian Date → Unix-seconds. Inverse of `tToJDE`. */
export function jdeToT(jde: number): number {
  return (jde - UNIX_EPOCH_JD) * 86400;
}

/** True when `t` is within `toleranceSec` of the current wall-clock. */
export function isLive(t: number, toleranceSec: number = LIVE_TOLERANCE_SEC): boolean {
  return Math.abs(t - Date.now() / 1000) < toleranceSec;
}
