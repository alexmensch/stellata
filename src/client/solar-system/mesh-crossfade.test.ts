import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLARE_GAIN,
  GLARE_BLOOM_OVERSIZE,
  GLARE_PHOTOCENTRE_SHIFT,
  glareSizePx,
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

describe('reflected-glare calibration constants', () => {
  it('caps the resolved bloom above the disc but not into a giant ring', () => {
    expect(GLARE_BLOOM_OVERSIZE).toBeGreaterThan(1);
    expect(GLARE_BLOOM_OVERSIZE).toBeLessThan(1.6);
  });

  it('shifts the photocentre a fraction of the radius toward the lit limb', () => {
    expect(GLARE_PHOTOCENTRE_SHIFT).toBeGreaterThan(0);
    expect(GLARE_PHOTOCENTRE_SHIFT).toBeLessThanOrEqual(1);
  });

  it('defaults the flux-continuity gain to a defined starting point', () => {
    expect(DEFAULT_GLARE_GAIN).toBeGreaterThan(0);
  });
});

describe('glareSizePx: point ↔ bloom on resolvedness', () => {
  it('is the star-perceptual point size when unresolved (res = 0)', () => {
    // At/below MESH_FADE_MIN_PX the true disc is sub-pixel: the glare is
    // the star point, size = appSize, regardless of physSize.
    expect(glareSizePx(12, 0)).toBe(12);
    expect(glareSizePx(12, MESH_FADE_MIN_PX)).toBe(12);
  });

  it('is the size-clamped bloom when fully resolved (res = 1)', () => {
    // At/above MESH_FADE_FULL_PX the glare collapses onto the disc: the
    // bloom is exactly physSize · OVERSIZE, independent of appSize — a
    // bright body (huge appSize) can no longer balloon a giant halo.
    expect(glareSizePx(24, 10)).toBeCloseTo(10 * GLARE_BLOOM_OVERSIZE, 10);
    expect(glareSizePx(2, 10)).toBeCloseTo(10 * GLARE_BLOOM_OVERSIZE, 10);
  });

  it('interpolates continuously across the band (no size pop)', () => {
    const mid = (MESH_FADE_MIN_PX + MESH_FADE_FULL_PX) / 2;
    const appSize = 8;
    const bloom = mid * GLARE_BLOOM_OVERSIZE;
    expect(glareSizePx(appSize, mid)).toBeCloseTo(
      appSize + 0.5 * (bloom - appSize),
      10,
    );
    // Continuous at both band edges — the value at the edge equals the
    // regime it hands off to.
    expect(glareSizePx(appSize, MESH_FADE_MIN_PX)).toBe(appSize);
    expect(glareSizePx(appSize, MESH_FADE_FULL_PX)).toBeCloseTo(
      MESH_FADE_FULL_PX * GLARE_BLOOM_OVERSIZE,
      10,
    );
  });
});
