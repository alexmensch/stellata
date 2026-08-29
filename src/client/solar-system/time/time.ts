// Simulation time `t` (Unix-seconds double) + UTC ↔ Julian-day helpers.
// See src/client/solar-system/README.md § Time.

import { DAYS_PER_JULIAN_YEAR, J2000_JD } from '../../util/astronomy-constants';
import { deltaTSeconds } from './delta-t-pure';

// Julian Date of the Unix epoch (1970-01-01T00:00:00Z). Subtracting
// from any JD gives Unix-seconds × 86400.
const UNIX_EPOCH_JD = 2440587.5;

// Tolerance (seconds) under which a value of `t` is considered "live"
// — i.e. tracking wall-clock now rather than a scrubber-pinned point.
// Driven by the readout to label "Live" vs an
// explicit timestamp; small enough that the per-second tick still
// reads as live, large enough to absorb scheduler jitter.
const LIVE_TOLERANCE_SEC = 1;

/** Unix-seconds → Julian Date, **UTC** scale — the scale `t` itself runs in. */
export function tToJdUt(t: number): number {
  return t / 86400 + UNIX_EPOCH_JD;
}

/** Unix-seconds → Julian Date in the **TDB** scale the JPL element tables and
 *  the Standish series are both defined against. Every ephemeris evaluation
 *  reads through here; `tToJdUt` is the universal-time sibling, ΔT earlier.
 *  TDB departs from TT by under 2 ms, which no ephemeris here resolves. */
export function tToJdTdb(t: number): number {
  const jdUt = tToJdUt(t);
  return jdUt + deltaTSeconds(jdUt) / 86400;
}

/** Julian Date TDB → Unix-seconds. Inverse of `tToJdTdb`. ΔT changes by
 *  under 1e-6 of itself across one ΔT, so the fixed point converges to
 *  well under a microsecond in a single pass; three are taken for free. */
export function jdTdbToT(jdTdb: number): number {
  let jdUt = jdTdb;
  for (let i = 0; i < 3; i++) jdUt = jdTdb - deltaTSeconds(jdUt) / 86400;
  return jdUtToT(jdUt);
}

/** Julian Date → Unix-seconds. Inverse of `tToJdUt`. */
export function jdUtToT(jde: number): number {
  return (jde - UNIX_EPOCH_JD) * 86400;
}

/** Julian epoch year (e.g. 2016.0) → Unix-seconds. */
export function julianEpochYearToT(jyr: number): number {
  return jdUtToT(J2000_JD + (jyr - 2000) * DAYS_PER_JULIAN_YEAR);
}

// Model-clock clamp: the Standish 1992 ephemeris window (3000 BC – 3000 AD;
// SCIENCE.md § Solar system). Outside it planet positions are garbage and
// linear star propagation has long since degraded, so `t` never leaves it.
export const T_CLAMP_MIN_S = julianEpochYearToT(-2999.0);
export const T_CLAMP_MAX_S = julianEpochYearToT(3001.0);

export function clampT(secs: number): number {
  return Math.min(Math.max(secs, T_CLAMP_MIN_S), T_CLAMP_MAX_S);
}

/** True when `t` is within `toleranceSec` of the current wall-clock. */
export function isLive(t: number, toleranceSec: number = LIVE_TOLERANCE_SEC): boolean {
  return Math.abs(t - Date.now() / 1000) < toleranceSec;
}

// Rate magnitude ceiling: 2^32 (~4.29e9×). Covers Myr/sec of orbital
// evolution without float-precision blowup in Kepler eval at typical
// solver tolerances. FF/RW saturate here rather than overflowing.
export const MAX_RATE = 2 ** 32;

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

/** The jump field's datetime format, for the placeholder and the README. */
export const LOCAL_DATETIME_FORMAT = 'YYYY-MM-DD HH:MM:SS';

/** The jump field's placeholder: the datetime format plus the JD escape. */
export const JUMP_FIELD_PLACEHOLDER = `${LOCAL_DATETIME_FORMAT} or JD`;

/** Epoch-ms → a zoneless jump-field value in **local** time:
 *  `2030-01-01 00:00:00`. Round-trips through `parseLocalDatetimeValue`. */
export function toLocalDatetimeValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const y = year < 0 ? `-${String(-year).padStart(4, '0')}` : String(year).padStart(4, '0');
  return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Either separator, seconds optional, every field acceptable unpadded. The
// year caps at 4 digits so it can't swallow a mistyped one; a 2-digit year is
// that year, never windowed into the 1900s — years 0-99 are inside the clock's
// range and reachable no other way.
const LOCAL_DATETIME_RE =
  /^(-?\d{1,4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

/** A zoneless jump-field value (→ **local** time) → epoch-ms, or NaN if it
 *  isn't `LOCAL_DATETIME_FORMAT`. Sibling of `toLocalDatetimeValue`.
 *  Strict rather than `new Date(value)` — see ./README.md § Time `t`. */
export function parseLocalDatetimeValue(value: string): number {
  const m = LOCAL_DATETIME_RE.exec(value.trim());
  if (m === null) return Number.NaN;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  // Only the time fields need a range check. An out-of-range month or day
  // moves the date, so the equality check below catches it; an out-of-range
  // minute or second can roll forward inside the same day, where it can't.
  if (hour > 23 || minute > 59 || second > 59) return Number.NaN;
  const d = new Date(year, month - 1, day, hour, minute, second, 0);
  // Years 0-99 are the Date constructor's 1900+ shorthand; the clock's
  // range covers them, so undo it.
  d.setFullYear(year, month - 1, day);
  // A rolled-over day (31 April) means the date does not exist.
  return d.getDate() === day && d.getMonth() === month - 1
    ? d.getTime()
    : Number.NaN;
}

// Optional "JD" prefix and TT/UT suffix around the number itself. An
// unprefixed integer needs >= 6 digits (a decimal point also qualifies):
// the clock's window is JD ~990574-2817152, so every reachable JD has six
// or seven, and the floor keeps a lone typed year from reading as one.
const JULIAN_DATE_RE = /^(jd\s*)?(\d{1,7}(?:\.\d+)?)\s*(tt|ut)?$/i;

/** A jump-field Julian Date entry → Unix-seconds `t`, or NaN if it isn't
 *  one. Sibling of `parseLocalDatetimeValue` — the second form the field
 *  accepts, because astronomically-pinned events are published as a JD and
 *  retyping one as a calendar date means doing the ΔT arithmetic by hand.
 *  The scale defaults to **TT** — what catalogues publish and what the
 *  readout's JD line shows — so a canon value round-trips verbatim; a
 *  `UT` suffix overrides (the two differ by ΔT: 13 hours at 2000 BC). */
export function parseJulianDateValue(value: string): number {
  const m = JULIAN_DATE_RE.exec(value.trim());
  if (m === null) return Number.NaN;
  const [, prefix, digits, scale] = m;
  if (prefix === undefined && !digits.includes('.') && digits.length < 6) {
    return Number.NaN;
  }
  const jd = Number(digits);
  return scale?.toUpperCase() === 'UT' ? jdUtToT(jd) : jdTdbToT(jd);
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
    const now = this.wallNow();
    const raw = this.simT0 + this.rate * (now - this.wallT0);
    if (raw < T_CLAMP_MIN_S || raw > T_CLAMP_MAX_S) {
      // Pin at the bound (re-anchored, so no invisible overshoot accrues —
      // the first opposite-direction transport step moves off it
      // immediately). Rate is left alone; the readout freezes at the bound.
      this.simT0 = clampT(raw);
      this.wallT0 = now;
      return this.simT0;
    }
    return raw;
  }

  getRate(): number {
    return this.rate;
  }

  setRate(r: number): void {
    const now = this.wallNow();
    this.simT0 = clampT(this.simT0 + this.rate * (now - this.wallT0));
    this.wallT0 = now;
    this.rate = r;
    if (r > 0) this.lastPositiveRate = r;
  }

  setTimeAbsolute(secs: number): void {
    this.simT0 = clampT(secs);
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

export type TransportAction = 'rewind' | 'play' | 'pause' | 'fastForward' | 'reset';

/** Transport-row spec for the scrubber widget: which clock method each
 *  control drives, plus its tooltip. The widget builds its buttons from
 *  this and adds side-effects (readout refresh, picker sync). */
export const TRANSPORT_BUTTONS: ReadonlyArray<{
  action: TransportAction;
  title: string;
}> = [
  { action: 'rewind', title: 'Rewind — halve, or reverse across 1×' },
  { action: 'play', title: 'Play — resume last forward rate' },
  { action: 'pause', title: 'Pause' },
  { action: 'fastForward', title: 'Fast-forward — double, or forward across 1×' },
  { action: 'reset', title: 'Reset to live now at 1×' },
];
