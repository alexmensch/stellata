import { describe, expect, it } from 'vitest';
import {
  DEPTH_DIM_CLEARANCE_PC, DEPTH_DIM_POWER, NEAR_FADE_EXTENT_FRAC,
  rimDistancesForExtent, shellDistanceAttenuation,
} from './shell-distance-pure';

const REF = DEPTH_DIM_CLEARANCE_PC;
const POW = DEPTH_DIM_POWER;

/** The attenuation with the depth term held at 1, so the near-fade ramp is
 *  the only thing under test. */
const nearOnly = (dPc: number, nearFadePc: number): number =>
  shellDistanceAttenuation(dPc, nearFadePc, Number.POSITIVE_INFINITY, POW);

/** The attenuation with the near-fade held at 1, so the depth dimming is
 *  the only thing under test. */
const depthOnly = (dPc: number): number => depthOnlyAt(dPc, REF);

/** The same, against an explicit reference, for comparing two scales. */
const depthOnlyAt = (dPc: number, refPc: number): number =>
  shellDistanceAttenuation(dPc, 0, refPc, POW);

describe('the reaches a shell derives from its own extent', () => {
  it('takes the near-fade as one shared proportion of the extent', () => {
    expect(NEAR_FADE_EXTENT_FRAC).toBe(0.6);
    expect(rimDistancesForExtent(300).nearFadePc).toBeCloseTo(180, 10);
    expect(rimDistancesForExtent(20).nearFadePc).toBeCloseTo(12, 10);
  });

  // The clearance is headroom past the shell's own surface, so a shell
  // wider than the clearance still gets a full-brightness band outside it.
  it('takes the depth reference as the extent plus the shared clearance', () => {
    expect(DEPTH_DIM_CLEARANCE_PC).toBe(150);
    expect(rimDistancesForExtent(20).depthDimRefPc).toBe(170);
    expect(rimDistancesForExtent(300).depthDimRefPc).toBe(450);
    expect(rimDistancesForExtent(0).depthDimRefPc).toBe(150);
  });

  // The defect an absolute reference had: the Local Bubble's far wall sat
  // beyond a flat 150 pc from every vantage its own cull let you see it
  // from, so no camera position rendered the whole wall undimmed.
  it('clears a shell wider than the clearance at its own framing distance', () => {
    const extent = 300;
    const { depthDimRefPc } = rimDistancesForExtent(extent);
    const nearWallAtPark = 2.4 * extent - extent;
    expect(depthOnlyAt(nearWallAtPark, depthDimRefPc)).toBe(1);
    expect(depthOnlyAt(nearWallAtPark, DEPTH_DIM_CLEARANCE_PC)).toBeLessThan(0.6);
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

  // Below 1, so the ~50–2500 pc cloud span stays readable rather than
  // running to the dither floor: twice as far is well over half as bright.
  it('falls off sub-linearly beyond it', () => {
    expect(DEPTH_DIM_POWER).toBe(0.6);
    expect(depthOnly(2 * REF)).toBeCloseTo(0.5 ** 0.6, 10);
    expect(depthOnly(2 * REF)).toBeGreaterThan(0.5);
    expect(depthOnly(4 * REF)).toBeGreaterThan(0.25);
  });

  it('still ranks every distance, never flattening two apart', () => {
    expect(depthOnly(400)).toBeLessThan(depthOnly(300));
    expect(depthOnly(2000)).toBeLessThan(depthOnly(1000));
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
