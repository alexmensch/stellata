import { describe, it, expect } from 'vitest';
import {
  PINCH_NOTCH_GAIN,
  WHEEL_NOTCH_DELTA_PX,
  pinchStep,
} from './pinch-zoom-pure';

describe('pinchStep', () => {
  it('pins the notch unit and the pinch gain', () => {
    expect(WHEEL_NOTCH_DELTA_PX).toBe(100);
    expect(PINCH_NOTCH_GAIN).toBe(12);
  });

  it('carries a sub-notch pinch delta instead of dropping it', () => {
    // A single trackpad pinch event is a few px — far under a notch even
    // amplified. Dropping it is what made pinch feel dead.
    const step = pinchStep(0, 2);
    expect(step.notch).toBe(0);
    expect(step.carriedPx).toBe(2 * PINCH_NOTCH_GAIN);
  });

  it('accumulates successive pinch events into whole notches', () => {
    let carriedPx = 0;
    const notches: number[] = [];
    // Ten events of 4 px = 480 gained px = 4 notches, remainder carried.
    for (let i = 0; i < 10; i++) {
      const step = pinchStep(carriedPx, 4);
      carriedPx = step.carriedPx;
      if (step.notch !== 0) notches.push(step.notch);
    }
    expect(notches).toEqual([1, 1, 1, 1]);
    expect(carriedPx).toBe(480 - 4 * WHEEL_NOTCH_DELTA_PX);
  });

  it('signs zoom-in and zoom-out oppositely', () => {
    expect(pinchStep(0, 20).notch).toBe(1);
    expect(pinchStep(0, -20).notch).toBe(-1);
  });

  it('spends a genuine Ctrl+wheel notch as exactly one notch', () => {
    // Browsers report pinch and Ctrl+wheel identically, so the per-event cap
    // is what keeps a real notch from zooming by the whole gain.
    const step = pinchStep(0, WHEEL_NOTCH_DELTA_PX);
    expect(step.notch).toBe(1);
    expect(step.carriedPx).toBe(0);
  });

  it('never builds a carry backlog that outlives the gesture', () => {
    let carriedPx = 0;
    for (let i = 0; i < 20; i++) carriedPx = pinchStep(carriedPx, 50).carriedPx;
    expect(Math.abs(carriedPx)).toBeLessThan(WHEEL_NOTCH_DELTA_PX);
  });

  it('reverses direction within one notch of the turnaround', () => {
    // Zoom in most of a notch, then pinch the other way: the carry unwinds
    // rather than the gesture stalling until it repays a backlog.
    const inward = pinchStep(0, 7);
    expect(inward.notch).toBe(0);
    const outward = pinchStep(inward.carriedPx, -7);
    expect(outward.notch).toBe(0);
    expect(outward.carriedPx).toBe(0);
  });
});
