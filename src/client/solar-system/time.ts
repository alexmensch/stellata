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

// Rate magnitude ceiling: 2^30 (~1.07e9×). Covers Myr/sec of orbital
// evolution without float-precision blowup in Kepler eval at typical
// solver tolerances. FF/RW saturate here rather than overflowing.
export const MAX_RATE = 2 ** 30;

// FF/RW step through powers of two crossing zero directly: ±1 are the
// closest-to-zero non-paused speeds, so a step from +1 lands on -1 (and
// vice versa) rather than passing through fractional slow-motion.
export function nextFastForwardRate(rate: number): number {
  if (rate === 0) return 1;
  if (rate > 0) return Math.min(rate * 2, MAX_RATE);
  return rate === -1 ? 1 : rate / 2;
}

export function nextRewindRate(rate: number): number {
  if (rate === 0) return -1;
  if (rate < 0) return Math.max(rate * 2, -MAX_RATE);
  return rate === 1 ? -1 : rate / 2;
}

/** Compact multiplier label for the scrubber readout: `paused`, `1×`,
 *  `-16×`, `1024×`. */
export function formatRate(rate: number): string {
  return rate === 0 ? 'paused' : `${rate}×`;
}

/** Virtual clock behind `Stellata.getT()`. `getT() = simT0 + rate ·
 *  (wallNow − wallT0)`, so at `rate = 1` in steady state it tracks
 *  wall-clock exactly. Rate flips snapshot the current virtual time so
 *  time never teleports. This is the ONLY place wall-clock is sampled
 *  for the simulation `t`; every consumer reads through `getT()`. */
export class VirtualClock {
  private simT0: number;
  private wallT0: number;
  private rate = 1;
  private lastPositiveRate = 1;
  private readonly wallNow: () => number;

  constructor(wallNow: () => number = () => Date.now() / 1000) {
    this.wallNow = wallNow;
    this.simT0 = wallNow();
    this.wallT0 = this.simT0;
  }

  getT(): number {
    return this.simT0 + this.rate * (this.wallNow() - this.wallT0);
  }

  getRate(): number {
    return this.rate;
  }

  setRate(r: number): void {
    const now = this.wallNow();
    this.simT0 += this.rate * (now - this.wallT0);
    this.wallT0 = now;
    this.rate = r;
    if (r > 0) this.lastPositiveRate = r;
  }

  setTimeAbsolute(secs: number): void {
    this.simT0 = secs;
    this.wallT0 = this.wallNow();
  }

  reset(): void {
    const now = this.wallNow();
    this.simT0 = now;
    this.wallT0 = now;
    this.rate = 1;
    this.lastPositiveRate = 1;
  }

  play(): void { this.setRate(this.lastPositiveRate); }
  pause(): void { this.setRate(0); }
  fastForward(): void { this.setRate(nextFastForwardRate(this.rate)); }
  rewind(): void { this.setRate(nextRewindRate(this.rate)); }
}
