import { describe, it, expect, vi, afterEach } from 'vitest';
import { J2000_JD } from '../../util/astronomy-constants';
import { deltaTSeconds } from './delta-t-pure';
import {
  MAX_RATE,
  T_CLAMP_MAX_S,
  T_CLAMP_MIN_S,
  VirtualClock,
  clampT,
  isLive,
  jdTdbToT,
  julianEpochYearToT,
  nextFastForwardRate,
  nextRewindRate,
  parseJulianDateValue,
  parseJumpEntry,
  parseLocalDatetimeValue,
  tToJdUt,
  tToJdTdb,
  toLocalDatetimeValue,
  jdUtToT,
  JUMP_FIELD_PLACEHOLDER,
  LOCAL_DATETIME_FORMAT,
} from './time';

describe('tToJdUt', () => {
  it('maps the Unix epoch to JD 2440587.5', () => {
    expect(tToJdUt(0)).toBe(2440587.5);
  });

  it('maps the UTC instant 2000-01-01T12:00:00Z to JD 2451545.0 exactly', () => {
    expect(tToJdUt(946728000)).toBe(2451545.0);
  });

  it('round-trips a JD back to seconds within sub-millisecond float64 noise for typical scrubber values', () => {
    // JD at present-epoch Unix-seconds is ~2.46e6, leaving ~9 decimal digits
    // for the fractional day after the integer Float64 chews. Multiplied by
    // 86400 that lands round-trip noise around 1e-4 sec — well below VSOP87
    // sensitivity, but coarser than toBeCloseTo's machine-precision threshold.
    const tIn = 1.78e9; // ~2026
    const jd = tToJdUt(tIn);
    const back = (jd - 2440587.5) * 86400;
    expect(Math.abs(back - tIn)).toBeLessThan(1e-3);
  });

  it('advances by exactly one day for a 86400-second delta', () => {
    expect(tToJdUt(86400) - tToJdUt(0)).toBe(1);
  });
});

describe('tToJdTdb', () => {
  it('runs ΔT ahead of the universal-time sibling', () => {
    // Differencing two ~2.44e6 Julian Dates leaves ~1e-5 s of float64 noise.
    const gap = (tToJdTdb(0) - tToJdUt(0)) * 86400;
    expect(gap).toBeCloseTo(deltaTSeconds(tToJdUt(0)), 4);
    // 1970 sat at ΔT ≈ 40 s, well clear of today's ~69 s: a regression to
    // a fixed TT−UTC constant reads the same at every epoch.
    expect(gap).toBeGreaterThan(38);
    expect(gap).toBeLessThan(42);
  });

  it('lands J2000.0 on JD 2451545.0 — the epoch the element tables count from', () => {
    // The UT instant is 12:00:00Z; J2000.0 is 12:00:00 TT, ΔT later on this
    // clock. Feeding the UT-scale JD to the ephemeris instead moves Mercury
    // by 2.2e-5 AU.
    const j2000Ut = 946728000 - deltaTSeconds(J2000_JD);
    expect(tToJdTdb(j2000Ut)).toBeCloseTo(2451545.0, 8);
  });

  it('round-trips through jdTdbToT, at both clamp bounds', () => {
    // ΔT reaches 20.5 h at the lower bound, so the inverse is a fixed
    // point rather than a subtraction; a single-pass version still lands
    // inside a millisecond, and this is what catches it going missing.
    for (const t of [1.78e9, T_CLAMP_MIN_S, T_CLAMP_MAX_S]) {
      expect(Math.abs(jdTdbToT(tToJdTdb(t)) - t)).toBeLessThan(1e-3);
    }
  });
});

describe('isLive', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for t === now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
    const now = Date.now() / 1000;
    expect(isLive(now)).toBe(true);
  });

  it('returns true within the default 1s tolerance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
    const now = Date.now() / 1000;
    expect(isLive(now - 0.5)).toBe(true);
    expect(isLive(now + 0.5)).toBe(true);
  });

  it('returns false beyond the default 1s tolerance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
    const now = Date.now() / 1000;
    expect(isLive(now - 2)).toBe(false);
    expect(isLive(now + 2)).toBe(false);
  });

  it('honours a custom tolerance', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
    const now = Date.now() / 1000;
    expect(isLive(now - 30, 60)).toBe(true);
    expect(isLive(now - 30, 10)).toBe(false);
  });
});

// Mutable fake wall-clock (seconds) so the virtual-clock math is exercised
// deterministically without touching Date.now().
function fakeWall() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (dt: number) => { now += dt; },
  };
}

describe('nextFastForwardRate', () => {
  it('doubles a positive rate', () => {
    expect(nextFastForwardRate(1)).toBe(2);
    expect(nextFastForwardRate(32)).toBe(64);
  });

  it('starts from paused at +1', () => {
    expect(nextFastForwardRate(0)).toBe(1);
  });

  it('climbs a negative rate toward zero, crossing to +1 at -1', () => {
    expect(nextFastForwardRate(-16)).toBe(-8);
    expect(nextFastForwardRate(-1)).toBe(1);
  });

  it('saturates at MAX_RATE', () => {
    expect(nextFastForwardRate(MAX_RATE)).toBe(MAX_RATE);
    expect(nextFastForwardRate(MAX_RATE / 2)).toBe(MAX_RATE);
  });

  it('6× FF from 1 reaches 64', () => {
    let r = 1;
    for (let i = 0; i < 6; i++) r = nextFastForwardRate(r);
    expect(r).toBe(64);
  });
});

describe('nextRewindRate', () => {
  it('doubles the magnitude of a negative rate (faster reverse)', () => {
    expect(nextRewindRate(-1)).toBe(-2);
    expect(nextRewindRate(-16)).toBe(-32);
  });

  it('starts from paused at -1', () => {
    expect(nextRewindRate(0)).toBe(-1);
  });

  it('slows a positive rate toward zero, crossing to -1 at +1', () => {
    expect(nextRewindRate(16)).toBe(8);
    expect(nextRewindRate(1)).toBe(-1);
  });

  it('saturates at -MAX_RATE', () => {
    expect(nextRewindRate(-MAX_RATE)).toBe(-MAX_RATE);
    expect(nextRewindRate(-MAX_RATE / 2)).toBe(-MAX_RATE);
  });
});

describe('VirtualClock', () => {
  it('tracks wall-clock at rate 1 in steady state', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    expect(c.getT()).toBe(w.now());
    w.advance(42);
    expect(c.getT()).toBe(w.now());
  });

  it('freezes when paused', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.pause();
    const frozen = c.getT();
    w.advance(100);
    expect(c.getT()).toBe(frozen);
    expect(c.getRate()).toBe(0);
  });

  it('advances at the set rate', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    const t0 = c.getT();
    c.setRate(64);
    w.advance(10);
    expect(c.getT()).toBe(t0 + 64 * 10);
  });

  it('rate flip preserves virtual time — no teleport', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.setRate(8);
    w.advance(5); // virtual advances 40
    const before = c.getT();
    c.setRate(-2); // flip forward → reverse
    expect(c.getT()).toBe(before);
    w.advance(3); // now rewinds 6
    expect(c.getT()).toBe(before - 6);
  });

  it('jump sets the instant and preserves rate', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.setRate(16);
    c.setTimeAbsolute(5000);
    expect(c.getRate()).toBe(16);
    expect(c.getT()).toBe(5000);
    w.advance(2);
    expect(c.getT()).toBe(5000 + 16 * 2);
  });

  it('reset round-trips to wall-clock now and rate 1', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.setRate(-32);
    c.setTimeAbsolute(12345);
    w.advance(50);
    c.reset();
    expect(c.getRate()).toBe(1);
    expect(c.getT()).toBe(w.now());
  });

  it('play resumes the last forward rate after pause', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.setRate(32);
    c.pause();
    c.play();
    expect(c.getRate()).toBe(32);
  });

  it('play defaults to +1 when no forward rate was ever set', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.setRate(-8);
    c.pause();
    c.play();
    expect(c.getRate()).toBe(1);
  });

  it('does not remember a reverse rate as the play rate', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.setRate(-4);
    c.pause();
    c.play();
    expect(c.getRate()).toBe(1);
  });

  it('FF transport clamps at MAX_RATE through the clock', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    for (let i = 0; i < 40; i++) c.fastForward();
    expect(c.getRate()).toBe(MAX_RATE);
  });
});

describe('model-clock clamp (Standish window)', () => {
  it('julianEpochYearToT maps J2000.0 to the J2000 Unix instant', () => {
    expect(julianEpochYearToT(2000)).toBe(946728000);
  });

  it('pins the clamp bounds to 3000 BC / 3000 AD Julian epoch years', () => {
    expect(T_CLAMP_MIN_S).toBe(julianEpochYearToT(-2999));
    expect(T_CLAMP_MAX_S).toBe(julianEpochYearToT(3001));
  });

  it('setTimeAbsolute clamps a jump beyond either bound', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.pause();
    c.setTimeAbsolute(T_CLAMP_MAX_S + 1e12);
    expect(c.getT()).toBe(T_CLAMP_MAX_S);
    c.setTimeAbsolute(T_CLAMP_MIN_S - 1e12);
    expect(c.getT()).toBe(T_CLAMP_MIN_S);
  });

  it('a running clock pins at the bound with its rate intact', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.setRate(MAX_RATE);
    w.advance(1e7); // raw t would overshoot the bound by orders of magnitude
    expect(c.getT()).toBe(T_CLAMP_MAX_S);
    expect(c.getRate()).toBe(MAX_RATE);
  });

  it('no invisible overshoot accrues while pinned — reversing moves off the bound immediately', () => {
    const w = fakeWall();
    const c = new VirtualClock(w.now);
    c.setRate(MAX_RATE);
    w.advance(1e7);
    c.setRate(-64);
    w.advance(10);
    expect(c.getT()).toBe(T_CLAMP_MAX_S - 640);
  });
});

describe('jump-field value round-trip', () => {
  const nan = (v: string): boolean => Number.isNaN(parseLocalDatetimeValue(v));

  it('round-trips a whole-second instant through local encode/decode', () => {
    // Any timezone: encode uses local getters, decode reads zoneless as
    // local, so the round-trip is TZ-independent (down to whole seconds,
    // which is all the field's format carries).
    const ms = Date.UTC(2030, 0, 1, 12, 34, 56);
    expect(parseLocalDatetimeValue(toLocalDatetimeValue(ms))).toBe(ms);
  });

  it('encodes as a zoneless YYYY-MM-DD HH:MM:SS string (no trailing Z)', () => {
    expect(toLocalDatetimeValue(Date.UTC(2030, 0, 1, 0, 0, 0))).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });

  it('round-trips a BC instant, which the native input never accepted', () => {
    const d = new Date(0);
    d.setFullYear(-2999, 5, 15);
    d.setHours(4, 5, 6, 0);
    expect(parseLocalDatetimeValue(toLocalDatetimeValue(d.getTime()))).toBe(d.getTime());
  });

  it('round-trips a year inside the Date constructor 1900+ shorthand band', () => {
    // new Date(50, ...) is 1950; the clock's range covers year 50 itself.
    const d = new Date(0);
    d.setFullYear(50, 0, 2);
    d.setHours(0, 0, 0, 0);
    expect(parseLocalDatetimeValue(toLocalDatetimeValue(d.getTime()))).toBe(d.getTime());
  });

  it('accepts either separator, and makes seconds optional', () => {
    const withT = parseLocalDatetimeValue('2030-01-01T12:34:56');
    expect(parseLocalDatetimeValue('2030-01-01 12:34:56')).toBe(withT);
    expect(parseLocalDatetimeValue('2030-01-01 12:34'))
      .toBe(new Date(2030, 0, 1, 12, 34, 0, 0).getTime());
  });

  it('yields NaN for an empty or garbage value', () => {
    expect(nan('')).toBe(true);
    expect(nan('not-a-date')).toBe(true);
  });

  // The whole reason the parse is strict rather than `new Date(value)`:
  // that constructor accepts these AND reads them as UTC, so a half-typed
  // entry would jump to a different instant than the same digits denote
  // once complete.
  it('rejects the partial forms new Date() would silently accept as UTC', () => {
    expect(nan('2030')).toBe(true);
    expect(nan('2030-01')).toBe(true);
    expect(nan('2030-01-01')).toBe(true);
    expect(nan('2030-01-01T12:34:56Z')).toBe(true);
    expect(nan('Jan 1 2030')).toBe(true);
  });

  it('rejects out-of-range and non-existent components', () => {
    expect(nan('2030-13-01 00:00:00')).toBe(true);
    expect(nan('2030-00-01 00:00:00')).toBe(true);
    expect(nan('2030-01-32 00:00:00')).toBe(true);
    expect(nan('2030-01-01 24:00:00')).toBe(true);
    expect(nan('2030-01-01 00:60:00')).toBe(true);
    expect(nan('2030-01-01 00:00:60')).toBe(true);
    // Rolls over to 1 May under the Date constructor, so it must not pass.
    expect(nan('2030-04-31 00:00:00')).toBe(true);
    expect(nan('2030-02-30 00:00:00')).toBe(true);
    // ...but a real leap day does.
    expect(nan('2028-02-29 00:00:00')).toBe(false);
  });

  it('accepts every field unpadded', () => {
    expect(parseLocalDatetimeValue('2030-1-1 1:2:3'))
      .toBe(parseLocalDatetimeValue('2030-01-01 01:02:03'));
    expect(parseLocalDatetimeValue('78-4-1 1:20:0'))
      .toBe(parseLocalDatetimeValue('0078-04-01 01:20:00'));
    expect(parseLocalDatetimeValue('78-4-1 1:20'))
      .toBe(parseLocalDatetimeValue('0078-04-01 01:20:00'));
  });

  it('reads a 2-digit year as that year, never windowed into the 1900s', () => {
    const d = new Date(0);
    d.setFullYear(78, 3, 1);
    d.setHours(1, 20, 0, 0);
    expect(parseLocalDatetimeValue('78-4-1 1:20')).toBe(d.getTime());
    expect(toLocalDatetimeValue(parseLocalDatetimeValue('78-4-1 1:20')))
      .toBe('0078-04-01 01:20:00');
  });

  it('caps the year at 4 digits so a mistyped one cannot run on', () => {
    expect(nan('99999-01-01 00:00:00')).toBe(true);
  });

  it('rejects a zero day, which rolls back into the previous month', () => {
    expect(nan('2030-01-00 00:00:00')).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseLocalDatetimeValue('  2030-01-01 12:34:56  '))
      .toBe(parseLocalDatetimeValue('2030-01-01 12:34:56'));
  });

  it('the placeholder names the format the parser accepts', () => {
    expect(LOCAL_DATETIME_FORMAT).toBe('YYYY-MM-DD HH:MM:SS');
    expect(JUMP_FIELD_PLACEHOLDER).toBe('YYYY-MM-DD HH:MM:SS or JD');
    expect(nan(toLocalDatetimeValue(Date.UTC(2030, 0, 1)))).toBe(false);
  });
});

describe('parseJulianDateValue', () => {
  const nan = (v: string): boolean => Number.isNaN(parseJulianDateValue(v));

  it('reads a bare number as a Julian Date in TT — the scale canons publish', () => {
    // NASA Five Millennium Canon, -1999 Jun 12: greatest eclipse
    // JD 991085.63500 TT. Entering the published number must land the
    // clock on the event with no hand ΔT arithmetic.
    expect(parseJulianDateValue('991085.63500')).toBe(jdTdbToT(991085.63500));
  });

  it('accepts an optional JD prefix and TT suffix, case-insensitive', () => {
    const t = parseJulianDateValue('991085.63500');
    expect(parseJulianDateValue('JD 991085.63500 TT')).toBe(t);
    expect(parseJulianDateValue('jd991085.63500tt')).toBe(t);
  });

  it('a UT suffix overrides the TT default, ΔT apart — 13 h at 2000 BC', () => {
    const jd = 991085.63500;
    const gap = parseJulianDateValue(`${jd} UT`) - parseJulianDateValue(`${jd}`);
    // The TT read resolves ΔT at the UT epoch (fixed point), the reference
    // here at the TT one — ΔT itself moves ~0.04 s across its own 13 h span
    // this deep, so the comparison holds to tenths, not milliseconds.
    expect(gap).toBeCloseTo(deltaTSeconds(jd), 0);
    expect(gap).toBeGreaterThan(12 * 3600);
  });

  it('maps a modern UT-tagged JD exactly', () => {
    expect(parseJulianDateValue('JD 2451545.0 UT')).toBe(946728000);
    expect(parseJulianDateValue('JD 2451545.0 UT')).toBe(jdUtToT(2451545.0));
  });

  it('requires 6 digits of an unprefixed integer, so a lone year never reads as a JD', () => {
    expect(nan('2030')).toBe(true);
    expect(nan('12345')).toBe(true);
    expect(nan('991085')).toBe(false);
    // A decimal point or the JD prefix marks the intent explicitly.
    expect(nan('2030.5')).toBe(false);
    expect(nan('JD 2030')).toBe(false);
  });

  it('rejects garbage, other scale tags, and trailing text', () => {
    expect(nan('')).toBe(true);
    expect(nan('not-a-date')).toBe(true);
    expect(nan('991085.635 TDB')).toBe(true);
    expect(nan('991085.635x')).toBe(true);
    expect(nan('991085.')).toBe(true);
    expect(nan('-991085.635')).toBe(true);
  });

  it('never collides with the datetime form — dashes disqualify it', () => {
    expect(nan('2030-01-01 12:34:56')).toBe(true);
    expect(Number.isNaN(parseLocalDatetimeValue('991085.63500'))).toBe(true);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseJulianDateValue('  991085.63500  '))
      .toBe(parseJulianDateValue('991085.63500'));
  });
});

describe('parseJumpEntry', () => {
  it('answers in SECONDS for both forms, though the two parsers do not', () => {
    // The defect this exists to make impossible: parseLocalDatetimeValue
    // returns epoch-ms and parseJulianDateValue returns Unix-seconds, so a
    // dispatcher that forwards one of them unconverted is wrong by 1000 —
    // which at the clock's scale lands somewhere in the deep past rather
    // than failing visibly.
    const t = parseJumpEntry('2030-01-01 00:00:00');
    expect(t).toBe(parseLocalDatetimeValue('2030-01-01 00:00:00') / 1000);
    expect(t).toBeGreaterThan(1.8e9);
    expect(t).toBeLessThan(2.0e9);
  });

  it('falls through to the Julian Date form for a bare number', () => {
    expect(parseJumpEntry('991085.63500')).toBe(parseJulianDateValue('991085.63500'));
    expect(parseJumpEntry('JD 2451545.0 UT')).toBe(946728000);
  });

  it('prefers the datetime form where both could look plausible', () => {
    // Dashes disqualify the JD form, so the order is not load-bearing for
    // any currently accepted string — pinned so a looser JD regex cannot
    // quietly start winning entries the datetime parser already handles.
    expect(parseJumpEntry('2030-01-01 12:34:56'))
      .toBe(parseLocalDatetimeValue('2030-01-01 12:34:56') / 1000);
  });

  it('is NaN when neither form matches', () => {
    for (const bad of ['', 'not-a-date', '2030', '991085.635 TDB', '31 Dec 2030']) {
      expect(Number.isNaN(parseJumpEntry(bad)), bad).toBe(true);
    }
  });
});

// What the widget echoes back after a jump: the clamped *target*, never a
// re-read of the clock — at a high rate the work between the two is a
// visible slice of model time.
describe('jump-field echo-back', () => {
  const echo = (entry: string): string =>
    toLocalDatetimeValue(clampT(parseLocalDatetimeValue(entry) / 1000) * 1000);

  it('echoes an in-range entry back unchanged', () => {
    expect(echo('2030-01-01 12:34:56')).toBe('2030-01-01 12:34:56');
  });

  it('echoes the upper bound for an entry past 3000 AD', () => {
    expect(echo('9999-01-01 00:00:00')).toBe(toLocalDatetimeValue(T_CLAMP_MAX_S * 1000));
  });

  it('echoes the lower bound for an entry before 3000 BC', () => {
    expect(echo('-9999-01-01 00:00:00')).toBe(toLocalDatetimeValue(T_CLAMP_MIN_S * 1000));
  });
});
