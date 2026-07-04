import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MAX_RATE,
  VirtualClock,
  formatRate,
  isLive,
  nextFastForwardRate,
  nextRewindRate,
  tToJDE,
} from './time';

describe('tToJDE', () => {
  it('maps the Unix epoch to JD 2440587.5', () => {
    expect(tToJDE(0)).toBe(2440587.5);
  });

  it('maps J2000.0 (2000-01-01T12:00:00 TT) to JD 2451545.0 within sub-second tolerance', () => {
    // J2000 in Unix-seconds is 946728000 (2000-01-01T12:00:00Z).
    // TT-UTC offset (~64.184s in 2000) is intentionally ignored — VSOP87D
    // is a TDB-scale theory and the helper documents the approximation.
    const jd = tToJDE(946728000);
    expect(Math.abs(jd - 2451545.0)).toBeLessThan(1 / 86400);
  });

  it('round-trips a JD back to seconds within sub-millisecond float64 noise for typical scrubber values', () => {
    // JD at present-epoch Unix-seconds is ~2.46e6, leaving ~9 decimal digits
    // for the fractional day after the integer Float64 chews. Multiplied by
    // 86400 that lands round-trip noise around 1e-4 sec — well below VSOP87
    // sensitivity, but coarser than toBeCloseTo's machine-precision threshold.
    const tIn = 1.78e9; // ~2026
    const jd = tToJDE(tIn);
    const back = (jd - 2440587.5) * 86400;
    expect(Math.abs(back - tIn)).toBeLessThan(1e-3);
  });

  it('advances by exactly one day for a 86400-second delta', () => {
    expect(tToJDE(86400) - tToJDE(0)).toBe(1);
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

describe('formatRate', () => {
  it('renders paused, forward, and reverse multipliers', () => {
    expect(formatRate(0)).toBe('paused');
    expect(formatRate(1)).toBe('1×');
    expect(formatRate(1024)).toBe('1024×');
    expect(formatRate(-16)).toBe('-16×');
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
