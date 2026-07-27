import { describe, it, expect } from 'vitest';
import {
  MAX_NOTCHES_PER_EVENT,
  NOTCH_SCALE_DELTA_PX,
  PINCH_NOTCH_GAIN,
  PINCH_SCALE_DELTA_PX,
  WHEEL_NOTCH_DELTA_PX,
  pinchStep,
  scaleStepDeltaPx,
} from './pinch-zoom-pure';

/** Pinch input worth `n` notches after amplification. Every case below is
 *  written in these units, so tuning either gain can't rot an assertion. */
const notchUnits = (n: number) => (n * WHEEL_NOTCH_DELTA_PX) / PINCH_NOTCH_GAIN;

describe('pinchStep', () => {
  it('pins the wheel-notch unit — a protocol constant, not a feel knob', () => {
    expect(WHEEL_NOTCH_DELTA_PX).toBe(100);
  });

  it('leaves the amplification path reachable at the configured gain', () => {
    // If a notch of pinch input ever exceeded the passthrough threshold, every
    // pinch event would read as a wheel tick and the gain would go dead — the
    // constraint that couples these two constants.
    expect(notchUnits(1)).toBeLessThan(NOTCH_SCALE_DELTA_PX);
  });

  it('carries a sub-notch pinch delta instead of dropping it', () => {
    // A single trackpad pinch event is a fraction of a notch even amplified.
    // Dropping it is what made pinch feel dead.
    const delta = notchUnits(0.4);
    const step = pinchStep(0, delta);
    expect(step.notches).toBe(0);
    expect(step.carriedPx).toBeCloseTo(delta * PINCH_NOTCH_GAIN, 9);
  });

  it('accumulates successive pinch events into whole notches', () => {
    let carriedPx = 0;
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const step = pinchStep(carriedPx, notchUnits(0.4));
      carriedPx = step.carriedPx;
      total += step.notches;
    }
    expect(total).toBe(4);
    expect(Math.abs(carriedPx)).toBeLessThan(WHEEL_NOTCH_DELTA_PX);
  });

  // The gain has to keep biting above one notch per event. Quantising the
  // result to ±1 is what left it inert: ordinary pinch events already sat at
  // that ceiling, so raising the gain by orders of magnitude changed nothing.
  it('scales linearly with the gain instead of saturating at one notch', () => {
    expect(pinchStep(0, notchUnits(1)).notches).toBe(1);
    expect(pinchStep(0, notchUnits(4)).notches).toBe(4);
    expect(pinchStep(0, notchUnits(9)).notches).toBe(9);
  });

  it('caps a mistyped gain rather than dispatching unboundedly', () => {
    expect(pinchStep(0, notchUnits(1e6)).notches).toBe(MAX_NOTCHES_PER_EVENT);
  });

  it('signs zoom-in and zoom-out oppositely', () => {
    expect(pinchStep(0, notchUnits(2)).notches).toBeGreaterThan(0);
    expect(pinchStep(0, notchUnits(-2)).notches).toBeLessThan(0);
  });

  it('spends a genuine Ctrl+wheel notch as exactly one notch', () => {
    // Browsers report pinch and Ctrl+wheel identically, so notch-scale deltas
    // pass through unamplified — otherwise a real tick zooms by the gain.
    const step = pinchStep(0, WHEEL_NOTCH_DELTA_PX);
    expect(step.notches).toBe(1);
    expect(step.carriedPx).toBe(0);
  });

  it('amplifies below the passthrough threshold and not at or above it', () => {
    const below = pinchStep(0, NOTCH_SCALE_DELTA_PX - 1);
    expect(below.notches * WHEEL_NOTCH_DELTA_PX + below.carriedPx)
      .toBeCloseTo((NOTCH_SCALE_DELTA_PX - 1) * PINCH_NOTCH_GAIN, 9);

    const atThreshold = pinchStep(0, NOTCH_SCALE_DELTA_PX);
    expect(atThreshold.notches * WHEEL_NOTCH_DELTA_PX + atThreshold.carriedPx)
      .toBeCloseTo(NOTCH_SCALE_DELTA_PX, 9);
  });

  it('never builds a carry backlog that outlives the gesture', () => {
    let carriedPx = 0;
    for (let i = 0; i < 20; i++) {
      carriedPx = pinchStep(carriedPx, notchUnits(0.7)).carriedPx;
    }
    expect(Math.abs(carriedPx)).toBeLessThan(WHEEL_NOTCH_DELTA_PX);
  });

  it('reverses direction within one notch of the turnaround', () => {
    // Zoom in most of a notch, then pinch the other way: the carry unwinds
    // rather than the gesture stalling until it repays a backlog.
    const inward = pinchStep(0, notchUnits(0.7));
    expect(inward.notches).toBe(0);
    const outward = pinchStep(inward.carriedPx, notchUnits(-0.7));
    expect(outward.notches).toBe(0);
    expect(outward.carriedPx).toBeCloseTo(0, 9);
  });
});

describe('scaleStepDeltaPx', () => {
  it('reads a spreading pinch as zoom-in, matching a negative wheel delta', () => {
    expect(scaleStepDeltaPx(1, 1.2)).toBeLessThan(0);
    expect(scaleStepDeltaPx(1.2, 1)).toBeGreaterThan(0);
  });

  it('is logarithmic, so equal ratios are equal deltas at any scale', () => {
    expect(scaleStepDeltaPx(1, 1.1)).toBeCloseTo(scaleStepDeltaPx(2, 2.2), 12);
  });

  it('composes across steps to the same delta as one big step', () => {
    const stepped = scaleStepDeltaPx(1, 1.5) + scaleStepDeltaPx(1.5, 2);
    expect(stepped).toBeCloseTo(scaleStepDeltaPx(1, 2), 12);
  });

  it('keeps a span-doubling pinch perceptible without being absurd', () => {
    // Deliberately wide: both gains are feel knobs tuned against real
    // trackpads, and the two browser paths need different balance. What must
    // not regress is the original bug (a full pinch that does nothing) and its
    // opposite (a flick that crosses the whole zoom range).
    const notches = Math.abs(scaleStepDeltaPx(1, 2)) * PINCH_NOTCH_GAIN / WHEEL_NOTCH_DELTA_PX;
    expect(notches).toBeGreaterThan(3);
    expect(notches).toBeLessThan(60);
  });

  it('scales linearly in PINCH_SCALE_DELTA_PX — the WebKit balance knob', () => {
    // Its whole job: move Safari's rate without touching Blink's.
    expect(Math.abs(scaleStepDeltaPx(1, Math.E))).toBeCloseTo(PINCH_SCALE_DELTA_PX, 9);
  });

  it('guards against a zero or negative scale', () => {
    expect(scaleStepDeltaPx(0, 1)).toBe(0);
    expect(scaleStepDeltaPx(1, 0)).toBe(0);
    expect(scaleStepDeltaPx(1, -1)).toBe(0);
  });
});
