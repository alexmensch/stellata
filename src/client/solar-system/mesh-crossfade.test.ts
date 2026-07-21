import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLARE_GAIN,
  GLARE_BLOOM_OVERSIZE,
  GLARE_MIN_PX,
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

  it('floors the sub-pixel glare above the mesh band so it stays visible', () => {
    expect(GLARE_MIN_PX).toBeGreaterThanOrEqual(MESH_FADE_MIN_PX);
  });

  it('defaults the flux-continuity gain to a defined starting point', () => {
    expect(DEFAULT_GLARE_GAIN).toBeGreaterThan(0);
  });
});

describe('glareSizePx: locally-active photographic footprint', () => {
  it('is the true disc · OVERSIZE once past the visibility floor', () => {
    // A resolved body's glare hugs the disc — exactly physSize · OVERSIZE,
    // no dependence on brightness (a bright body can't balloon a halo).
    expect(glareSizePx(10)).toBe(10 * GLARE_BLOOM_OVERSIZE);
    expect(glareSizePx(100)).toBe(100 * GLARE_BLOOM_OVERSIZE);
  });

  it('floors at GLARE_MIN_PX when the disc·OVERSIZE is sub-floor', () => {
    // A sub-pixel body renders at the floor (the shader scales its peak
    // down to conserve flux); size never collapses below the floor.
    expect(glareSizePx(0)).toBe(GLARE_MIN_PX);
    expect(glareSizePx(0.1)).toBe(GLARE_MIN_PX);
    const floorPhys = GLARE_MIN_PX / GLARE_BLOOM_OVERSIZE;
    expect(glareSizePx(floorPhys)).toBeCloseTo(GLARE_MIN_PX, 10);
  });

  it('is monotone non-decreasing in physSize', () => {
    let prev = -1;
    for (let px = 0; px <= 20; px += 0.05) {
      const s = glareSizePx(px);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
});
