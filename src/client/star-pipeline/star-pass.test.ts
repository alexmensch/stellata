import { describe, expect, it } from 'vitest';
import {
  STAR_PASS_CORE_MASK, STAR_PASS_DISC, STAR_PASS_GLOW, colourPassFor, starPassRouting,
} from './star-pass';

describe('star pass identities', () => {
  // The numeric identities are the shader contract: star.frag.glsl's
  // uRenderMode comparisons read literal 0/1/2. One pin here; every other
  // test imports the constants.
  it('match the uRenderMode values the GLSL shaders compare against', () => {
    expect(STAR_PASS_GLOW).toBe(0);
    expect(STAR_PASS_DISC).toBe(1);
    expect(STAR_PASS_CORE_MASK).toBe(2);
  });
});

describe('colourPassFor', () => {
  it('routes a physically dominated star to the disc pass', () => {
    expect(colourPassFor(12, 40)).toBe(STAR_PASS_DISC);
  });

  it('routes an apparent-magnitude-dominated star to the glow pass', () => {
    expect(colourPassFor(12, 1e-4)).toBe(STAR_PASS_GLOW);
  });

  it('sits the boundary exactly where the shaders split (physRatio 0.5)', () => {
    expect(colourPassFor(40, 20)).toBe(STAR_PASS_DISC);
    expect(colourPassFor(40, 19.999)).toBe(STAR_PASS_GLOW);
  });
});

describe('starPassRouting', () => {
  // A star just under the split undimmed (physSize 0.49 of the quad) —
  // where a marginally-resolved companion sits, and the band the split
  // used to drop the star in. `appSize` shrinks as the square root of a
  // dim's magnitude penalty, close enough to the real curve's shape for
  // the threshold solve to be exercised rather than mocked flat.
  const APP = 40;
  const PHYS = 0.49 * APP;
  const FLOOR = 0.001;
  const sizeAt = (dim: number) => APP * Math.sqrt(Math.max(dim, FLOOR));

  it('flags the band once the current dim crosses the split', () => {
    const r = starPassRouting(APP, PHYS, 0.5, FLOOR, sizeAt);
    expect(r.routed).toBe(STAR_PASS_GLOW);
    expect(r.dimmed).toBe(STAR_PASS_DISC);
    expect(r.trap).toBe(true);
  });

  it('stays clear while the dim leaves the star on the same side', () => {
    const r = starPassRouting(APP, PHYS, 0.99, FLOOR, sizeAt);
    expect(r.dimmed).toBe(STAR_PASS_GLOW);
    expect(r.trap).toBe(false);
  });

  it('solves the dim the band opens at, and it agrees with the flag', () => {
    // sizeAt(d) = 2·PHYS at d = (2 × 0.49)² = 0.9604.
    const r = starPassRouting(APP, PHYS, 1, FLOOR, sizeAt);
    expect(r.trapBelowDim).toBeCloseTo(0.9604, 4);
    expect(starPassRouting(APP, PHYS, 0.96, FLOOR, sizeAt).trap).toBe(true);
    expect(starPassRouting(APP, PHYS, 0.97, FLOOR, sizeAt).trap).toBe(false);
  });

  it('reports the ratio from the undimmed quad, which is what the shaders use', () => {
    expect(starPassRouting(APP, PHYS, 1, FLOOR, sizeAt).physRatio).toBeCloseTo(0.49, 10);
  });

  it('names the ratio the camera must reach for the current dim to flip it', () => {
    // sizeAt(0.64) shrinks the quad to 0.8 x, so the split moves to
    // physRatio 0.4 — and a star sitting there does flip, one just under
    // does not. This is the camera-side answer to trapBelowDim's
    // clock-side one.
    expect(starPassRouting(APP, PHYS, 0.64, FLOOR, sizeAt).needRatio).toBeCloseTo(0.4, 10);
    expect(starPassRouting(APP, 0.401 * APP, 0.64, FLOOR, sizeAt).trap).toBe(true);
    expect(starPassRouting(APP, 0.399 * APP, 0.64, FLOOR, sizeAt).trap).toBe(false);
  });

  it('gives a disc-routed star no threshold — that pass ignores the dim', () => {
    // physSize already wins max(appSize, physSize), so shrinking appSize
    // cannot move the ratio at all. The camera has to back off.
    const r = starPassRouting(10, 40, 0.02, FLOOR, sizeAt);
    expect(r.routed).toBe(STAR_PASS_DISC);
    expect(r.trap).toBe(false);
    expect(r.trapBelowDim).toBeNull();
  });

  it('gives a deeply glow-dominated star no threshold — totality cannot reach it', () => {
    // physSize far under half the quad: even the dim floor leaves the
    // shrunken appSize above 2 x physSize.
    const r = starPassRouting(APP, 0.001 * APP, 0.02, FLOOR, sizeAt);
    expect(r.routed).toBe(STAR_PASS_GLOW);
    expect(r.trapBelowDim).toBeNull();
  });
});
