import { describe, expect, it } from 'vitest';

import {
  DISC_FADE_END_RATIO,
  DISC_FADE_START_RATIO,
  discFadeFromRatio,
  MESH_FADE_FULL_PX,
  MESH_FADE_MIN_PX,
  meshFadeFromPhysPx,
  TEXTURE_PREFETCH_PX,
} from './mesh-crossfade';

describe('mesh fade band (physical pixels)', () => {
  it('spans the eye tracking limit, prefetch firing before it', () => {
    expect(MESH_FADE_MIN_PX).toBe(1);
    expect(MESH_FADE_FULL_PX).toBe(2);
    expect(TEXTURE_PREFETCH_PX).toBeLessThan(MESH_FADE_MIN_PX);
  });

  it('is 0 at/below the band and 1 at/above it', () => {
    expect(meshFadeFromPhysPx(0)).toBe(0);
    expect(meshFadeFromPhysPx(MESH_FADE_MIN_PX)).toBe(0);
    expect(meshFadeFromPhysPx(MESH_FADE_FULL_PX)).toBe(1);
    expect(meshFadeFromPhysPx(500)).toBe(1);
  });

  it('is smooth and monotonic across the band', () => {
    const mid = (MESH_FADE_MIN_PX + MESH_FADE_FULL_PX) / 2;
    expect(meshFadeFromPhysPx(mid)).toBeCloseTo(0.5, 10);
    let prev = -1;
    for (let px = 0; px <= MESH_FADE_FULL_PX + 1; px += 0.01) {
      const f = meshFadeFromPhysPx(px);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('billboard disc fade band (physSize/appSize ratio)', () => {
  it('starts at physSize = appSize — the core-hidden invariant', () => {
    // Below ratio 1 the perceptual disc exceeds the true angular size
    // (glare regime): the billboard must stay at full strength there.
    // From ratio 1 on, the disc core lies inside the mesh silhouette
    // (core radius < 0.5·quad), so only the halo annulus visibly fades.
    expect(DISC_FADE_START_RATIO).toBeGreaterThanOrEqual(1);
    expect(DISC_FADE_END_RATIO).toBeGreaterThan(DISC_FADE_START_RATIO);
  });

  it('is 1 below the band and 0 above it (shader vDiscFade mirror)', () => {
    expect(discFadeFromRatio(0)).toBe(1);
    expect(discFadeFromRatio(DISC_FADE_START_RATIO)).toBe(1);
    expect(discFadeFromRatio(DISC_FADE_END_RATIO)).toBe(0);
    expect(discFadeFromRatio(50)).toBe(0);
  });

  it('is smooth and monotonically decreasing across the band', () => {
    const mid = (DISC_FADE_START_RATIO + DISC_FADE_END_RATIO) / 2;
    expect(discFadeFromRatio(mid)).toBeCloseTo(0.5, 10);
    let prev = 2;
    for (let r = 0; r <= DISC_FADE_END_RATIO + 1; r += 0.01) {
      const f = discFadeFromRatio(r);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });
});
