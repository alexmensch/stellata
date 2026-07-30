import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  GLARE_PHOTOCENTRE_SHIFT,
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
  it('shifts the photocentre a fraction of the radius toward the lit limb', () => {
    expect(GLARE_PHOTOCENTRE_SHIFT).toBeGreaterThan(0);
    expect(GLARE_PHOTOCENTRE_SHIFT).toBeLessThanOrEqual(1);
  });

  it('has no glare peak multiplier — a planet reads as a star of its mag', () => {
    // The invariant used to be defended by a debug knob defaulting to 1;
    // now nothing can multiply the peak. glare/README.md.
    const glareVert = readFileSync(
      fileURLToPath(new URL('./glare/planet.vert.glsl', import.meta.url)), 'utf8');
    expect(glareVert).not.toMatch(/uGlareGain/);
  });
});
