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
  // A star just under the split undimmed (physSize 0.49 of the quad), and
  // the dimmed quad a deep eclipse shrinks it to. This is the band the
  // split used to drop the star in — both passes discarded it.
  const APP = 40;
  const PHYS = 0.49 * APP;

  it('flags the band where a dimmed appSize would pick the other pass', () => {
    const r = starPassRouting(APP, PHYS, PHYS * 1.9);
    expect(r.routed).toBe(STAR_PASS_GLOW);
    expect(r.dimmed).toBe(STAR_PASS_DISC);
    expect(r.trap).toBe(true);
  });

  it('reports no trap while the dim leaves the star on the same side', () => {
    const r = starPassRouting(APP, PHYS, APP * 0.99);
    expect(r.routed).toBe(STAR_PASS_GLOW);
    expect(r.dimmed).toBe(STAR_PASS_GLOW);
    expect(r.trap).toBe(false);
  });

  it('reports the ratio from the undimmed quad, which is what the shaders use', () => {
    expect(starPassRouting(APP, PHYS, PHYS).physRatio).toBeCloseTo(0.49, 10);
  });

  it('never reports a disc-dominant star as trapped — the dim cannot reach it', () => {
    // physSize already wins max(appSize, physSize), so shrinking appSize
    // cannot move the ratio at all.
    const r = starPassRouting(10, 40, 1);
    expect(r.routed).toBe(STAR_PASS_DISC);
    expect(r.trap).toBe(false);
  });
});
