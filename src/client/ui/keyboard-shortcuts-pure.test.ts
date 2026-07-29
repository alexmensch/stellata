import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  D_TRIPLE_TAP_COUNT,
  D_TRIPLE_TAP_MS,
  DOUBLE_TAP_COUNT,
  DOUBLE_TAP_MS,
  makeDoubleTapGate,
  pushTapAndCheckTriple,
  steppedEv,
} from './keyboard-shortcuts-pure';
import { EV_MAX_STOPS, EV_STEP_STOPS } from '../hdr/exposure/exposure-epoch';

describe('pushTapAndCheckTriple', () => {
  it('fires when three taps land inside the window', () => {
    const taps: number[] = [];
    expect(pushTapAndCheckTriple(taps, 0)).toBe(false);
    expect(pushTapAndCheckTriple(taps, 100)).toBe(false);
    expect(pushTapAndCheckTriple(taps, 200)).toBe(true);
  });

  it('does not fire when the first tap is outside the window', () => {
    const taps: number[] = [];
    // 0ms tap, then 200ms gap, then 401ms after the first: first tap
    // expires (> 500ms - we use 501ms to be unambiguous), so only two
    // taps remain in the window.
    pushTapAndCheckTriple(taps, 0);
    pushTapAndCheckTriple(taps, 200);
    expect(pushTapAndCheckTriple(taps, 501)).toBe(false);
  });

  it('resets after firing so the next press starts a fresh count', () => {
    const taps: number[] = [];
    pushTapAndCheckTriple(taps, 0);
    pushTapAndCheckTriple(taps, 100);
    expect(pushTapAndCheckTriple(taps, 200)).toBe(true);
    // Immediately after firing, a single follow-up tap must NOT refire —
    // it's the first of a new triple, not the fourth of the old one.
    expect(pushTapAndCheckTriple(taps, 250)).toBe(false);
    expect(pushTapAndCheckTriple(taps, 300)).toBe(false);
    expect(pushTapAndCheckTriple(taps, 350)).toBe(true);
  });

  it('slides the window forward, dropping only expired entries', () => {
    const taps: number[] = [];
    pushTapAndCheckTriple(taps, 0);
    pushTapAndCheckTriple(taps, 400);
    // At t=600 the first tap (t=0) is expired (> 500ms), the second
    // (t=400) is still inside. The third tap brings the count to two —
    // not three — so it must not fire.
    expect(pushTapAndCheckTriple(taps, 600)).toBe(false);
    // One more tap inside the window completes the triple.
    expect(pushTapAndCheckTriple(taps, 700)).toBe(true);
  });

  it('a single tap never fires', () => {
    const taps: number[] = [];
    expect(pushTapAndCheckTriple(taps, 0)).toBe(false);
  });

  it('a double tap never fires', () => {
    const taps: number[] = [];
    expect(pushTapAndCheckTriple(taps, 0)).toBe(false);
    expect(pushTapAndCheckTriple(taps, 100)).toBe(false);
  });

  it('three rapid taps at the window boundary still fire', () => {
    const taps: number[] = [];
    // Three taps exactly D_TRIPLE_TAP_MS apart (t=0, 0, window).
    // The first and the third are exactly windowMs apart, so the first
    // is at the inclusive edge — the implementation drops it only when
    // strictly older than the window.
    pushTapAndCheckTriple(taps, 0);
    pushTapAndCheckTriple(taps, 0);
    expect(pushTapAndCheckTriple(taps, D_TRIPLE_TAP_MS)).toBe(true);
  });

  it('honours custom window and count parameters', () => {
    const taps: number[] = [];
    pushTapAndCheckTriple(taps, 0, 100, 2);
    expect(pushTapAndCheckTriple(taps, 50, 100, 2)).toBe(true);
  });

  it('exports stable constants for the keyboard binding', () => {
    expect(D_TRIPLE_TAP_MS).toBe(500);
    expect(D_TRIPLE_TAP_COUNT).toBe(3);
    expect(DOUBLE_TAP_MS).toBe(200);
    expect(DOUBLE_TAP_COUNT).toBe(2);
  });

  it('fires on the second press with count=2 window params', () => {
    const taps: number[] = [];
    expect(pushTapAndCheckTriple(taps, 0, DOUBLE_TAP_MS, DOUBLE_TAP_COUNT)).toBe(false);
    expect(pushTapAndCheckTriple(taps, DOUBLE_TAP_MS, DOUBLE_TAP_MS, DOUBLE_TAP_COUNT)).toBe(true);
  });

  it('does not fire with count=2 params when the second press is too late', () => {
    const taps: number[] = [];
    pushTapAndCheckTriple(taps, 0, DOUBLE_TAP_MS, DOUBLE_TAP_COUNT);
    expect(pushTapAndCheckTriple(taps, DOUBLE_TAP_MS + 1, DOUBLE_TAP_MS, DOUBLE_TAP_COUNT)).toBe(false);
  });
});

describe('makeDoubleTapGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires onSingle after the window when pressed once', () => {
    const single = vi.fn();
    const double = vi.fn();
    const press = makeDoubleTapGate(single, double, 200);
    press();
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(single).toHaveBeenCalledOnce();
    expect(double).not.toHaveBeenCalled();
  });

  it('fires onDouble and cancels onSingle on a second press inside the window', () => {
    const single = vi.fn();
    const double = vi.fn();
    const press = makeDoubleTapGate(single, double, 200);
    press();
    press();
    expect(double).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(500);
    expect(single).not.toHaveBeenCalled();
  });

  it('treats a press after the window as a fresh single tap', () => {
    const single = vi.fn();
    const double = vi.fn();
    const press = makeDoubleTapGate(single, double, 200);
    press();
    vi.advanceTimersByTime(200);
    press();
    vi.advanceTimersByTime(200);
    expect(single).toHaveBeenCalledTimes(2);
    expect(double).not.toHaveBeenCalled();
  });

  it('defaults the window to DOUBLE_TAP_MS', () => {
    const single = vi.fn();
    const press = makeDoubleTapGate(single, vi.fn());
    press();
    vi.advanceTimersByTime(DOUBLE_TAP_MS - 1);
    expect(single).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(single).toHaveBeenCalledOnce();
  });
});

describe('steppedEv', () => {
  it('moves one grid stop per call, in both directions', () => {
    expect(steppedEv(0, +1)).toBeCloseTo(EV_STEP_STOPS, 12);
    expect(steppedEv(0, -1)).toBeCloseTo(-EV_STEP_STOPS, 12);
  });

  it('stays exactly on the grid across a full-range run of presses', () => {
    // Bit-identical to the canonical grid value at every stop, so the
    // ceiling press lands on EV_MAX_STOPS exactly rather than near it.
    let ev = 0;
    for (let i = 1; i <= 9; i++) {
      ev = steppedEv(ev, +1);
      expect(ev).toBe(i * EV_STEP_STOPS);
    }
    expect(ev).toBe(EV_MAX_STOPS);
  });

  it('snaps an off-grid value onto the grid before stepping', () => {
    // 0.2 is nearest grid index 1, so one step up lands on index 2.
    expect(steppedEv(0.2, +1)).toBeCloseTo(2 * EV_STEP_STOPS, 12);
    expect(steppedEv(0.45, -1)).toBe(0);
  });

  it("does not clamp — that is the controller's job", () => {
    expect(steppedEv(EV_MAX_STOPS, +1)).toBeGreaterThan(EV_MAX_STOPS);
  });
});
