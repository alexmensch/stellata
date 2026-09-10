import { describe, expect, it } from 'vitest';
import {
  DEPTH_DIM_POWER, DEPTH_DIM_REF_PC, NEAR_FADE_EXTENT_FRAC,
  nearFadePcForExtent, shellDistanceAttenuation,
} from './shell-distance-pure';

const REF = DEPTH_DIM_REF_PC;
const POW = DEPTH_DIM_POWER;

/** The attenuation with the depth term held at 1, so the near-fade ramp is
 *  the only thing under test. */
const nearOnly = (dPc: number, nearFadePc: number): number =>
  shellDistanceAttenuation(dPc, nearFadePc, Number.POSITIVE_INFINITY, POW);

/** The attenuation with the near-fade held at 1, so the depth dimming is
 *  the only thing under test. */
const depthOnly = (dPc: number): number =>
  shellDistanceAttenuation(dPc, 0, REF, POW);

describe('the shared near-fade proportion', () => {
  it('derives each shell fade distance from its own extent', () => {
    expect(NEAR_FADE_EXTENT_FRAC).toBe(0.6);
    expect(nearFadePcForExtent(300)).toBeCloseTo(180, 10);
    expect(nearFadePcForExtent(20)).toBeCloseTo(12, 10);
  });
});

describe('the near-fade ramp', () => {
  it('takes the alpha to nothing at the camera and to full at its reach', () => {
    expect(nearOnly(0, 100)).toBe(0);
    expect(nearOnly(50, 100)).toBeCloseTo(0.5, 10);
    expect(nearOnly(100, 100)).toBe(1);
  });

  // The wall the camera is crossing must ramp out, not pop: monotone in
  // between, and clamped rather than growing past its reach.
  it('holds at full brightness beyond its reach', () => {
    expect(nearOnly(100_000, 100)).toBe(1);
  });
});

describe('the depth dimming', () => {
  it('is a no-op inside the reference distance', () => {
    expect(depthOnly(REF)).toBe(1);
    expect(depthOnly(REF / 10)).toBe(1);
    // AU-scale: this is what makes the heliopause need no opt-out flag.
    expect(depthOnly(1e-3)).toBe(1);
  });

  it('is inverse-linear beyond it, so twice as far is half as bright', () => {
    expect(depthOnly(2 * REF)).toBeCloseTo(0.5, 10);
    expect(depthOnly(4 * REF)).toBeCloseTo(0.25, 10);
  });

  // The whole point of one absolute scale: a cloud beyond the Local Bubble
  // wall has to come out dimmer than the wall, with no per-shell
  // normalisation that would flatten the two together.
  it('orders a far shell below a near one on the same scale', () => {
    const wall = depthOnly(250);
    const cloudBeyond = depthOnly(700);
    expect(cloudBeyond).toBeLessThan(wall);
  });
});

describe('the two factors together', () => {
  it('multiply, so an approached far wall is dark on both counts', () => {
    const d = 400;
    expect(shellDistanceAttenuation(d, 1000, REF, POW))
      .toBeCloseTo(nearOnly(d, 1000) * depthOnly(d), 10);
  });

  it('reads a zero-distance fragment as fully faded, not as a divide blow-up', () => {
    expect(shellDistanceAttenuation(0, 180, REF, POW)).toBe(0);
  });
});
