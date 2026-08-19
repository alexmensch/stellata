import { describe, expect, it } from 'vitest';
import {
  STAR_PASS_CORE_MASK, STAR_PASS_DISC, STAR_PASS_GLOW, colourPassFor,
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
