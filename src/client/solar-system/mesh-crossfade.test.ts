import { describe, expect, it } from 'vitest';

import {
  MESH_FADE_END_RATIO,
  MESH_FADE_START_RATIO,
  meshFadeFromRatio,
  TEXTURE_PREFETCH_RATIO,
} from './mesh-crossfade';

describe('mesh crossfade band', () => {
  it('starts at physSize = appSize — the seamless-footprint invariant', () => {
    // Below ratio 1 the perceptual disc is larger than the true
    // angular size; fading the mesh in there shows two different-sized
    // discs (the reported pop). The band must start at or past
    // equality, and the prefetch must fire before it.
    expect(MESH_FADE_START_RATIO).toBeGreaterThanOrEqual(1);
    expect(MESH_FADE_END_RATIO).toBeGreaterThan(MESH_FADE_START_RATIO);
    expect(TEXTURE_PREFETCH_RATIO).toBeLessThan(MESH_FADE_START_RATIO);
  });

  it('is 0 below the band and 1 above it', () => {
    expect(meshFadeFromRatio(0)).toBe(0);
    expect(meshFadeFromRatio(MESH_FADE_START_RATIO)).toBe(0);
    expect(meshFadeFromRatio(MESH_FADE_END_RATIO)).toBe(1);
    expect(meshFadeFromRatio(50)).toBe(1);
  });

  it('is smooth and monotonic across the band', () => {
    const mid = (MESH_FADE_START_RATIO + MESH_FADE_END_RATIO) / 2;
    expect(meshFadeFromRatio(mid)).toBeCloseTo(0.5, 10);
    let prev = -1;
    for (let r = 0; r <= MESH_FADE_END_RATIO + 1; r += 0.01) {
      const f = meshFadeFromRatio(r);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});
