import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLARE_BLOOM_THRESHOLD,
  DEFAULT_GLARE_GAIN,
  GLARE_BLOOM_KNEE,
  GLARE_BLOOM_OVERSIZE,
  GLARE_MIN_PX,
  GLARE_PHOTOCENTRE_SHIFT,
  glareBasePeak,
  glareBloomAmount,
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

  it('defaults the glare gain to a defined starting point', () => {
    expect(DEFAULT_GLARE_GAIN).toBeGreaterThan(0);
  });

  it('bloom threshold + knee are positive (a real onset band)', () => {
    expect(DEFAULT_GLARE_BLOOM_THRESHOLD).toBeGreaterThan(0);
    expect(GLARE_BLOOM_KNEE).toBeGreaterThan(0);
  });
});

describe('glareBloomAmount: veiling-glare onset on lit-surface radiance', () => {
  it('is 0 at/below the threshold (dim surface = base only)', () => {
    expect(glareBloomAmount(0, 0.4)).toBe(0);
    expect(glareBloomAmount(0.4, 0.4)).toBe(0);
  });

  it('is 1 at/above threshold + knee (bright surface = full bloom)', () => {
    expect(glareBloomAmount(0.4 + GLARE_BLOOM_KNEE, 0.4)).toBe(1);
    expect(glareBloomAmount(5, 0.4)).toBe(1);
  });

  it('is monotone non-decreasing in radiance', () => {
    let prev = -1;
    for (let L = 0; L <= 2; L += 0.02) {
      const b = glareBloomAmount(L, 0.4);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('a brighter surface blooms at a lower threshold — the debug knob', () => {
    // Enceladus-ish (0.32) stays base at threshold 0.4 but blooms once
    // the threshold drops below it; Venus-ish (0.8) already blooms.
    expect(glareBloomAmount(0.32, 0.4)).toBe(0);
    expect(glareBloomAmount(0.32, 0.1)).toBeGreaterThan(0);
    expect(glareBloomAmount(0.8, 0.4)).toBeGreaterThan(0);
  });
});

describe('glareBasePeak: flux-conserving photographic base (peak ≤ radiance)', () => {
  it('equals the surface radiance once the disc·OVERSIZE clears the floor', () => {
    // ratio = 1 there, √1 = 1: the resolved base peak IS the surface
    // radiance (glare matches the mesh it sits over).
    const floorPhys = GLARE_MIN_PX / GLARE_BLOOM_OVERSIZE;
    expect(glareBasePeak(0.5, floorPhys)).toBeCloseTo(0.5, 10);
    expect(glareBasePeak(0.5, 10)).toBeCloseTo(0.5, 10);
  });

  it('never exceeds the surface radiance and dims toward 0 sub-pixel', () => {
    // A sub-pixel body's peak is ≤ its surface radiance (can't outshine a
    // resolved neighbour) and → 0 as the disc shrinks (dims on recede).
    expect(glareBasePeak(0.5, GLARE_MIN_PX / GLARE_BLOOM_OVERSIZE / 4)).toBeLessThan(0.5);
    expect(glareBasePeak(0.5, 0.001)).toBeLessThan(0.05);
  });

  it('is monotone non-decreasing in physSize (dims with distance)', () => {
    let prev = -1;
    for (let px = 0; px <= 5; px += 0.02) {
      const p = glareBasePeak(0.5, px);
      expect(p).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = p;
    }
  });
});

describe('glareSizePx: base ↔ bloom on the veiling-glare amount', () => {
  const baseSize = (physPx: number) => Math.max(physPx * GLARE_BLOOM_OVERSIZE, GLARE_MIN_PX);

  it('is the flux-conserving base disc when the surface is dim (bloom = 0)', () => {
    // A dim body is just its base: disc·OVERSIZE floored at GLARE_MIN_PX,
    // regardless of how bright a point it would be as a star.
    expect(glareSizePx(10, 24, 0)).toBe(baseSize(10));
    expect(glareSizePx(0.1, 24, 0)).toBe(GLARE_MIN_PX);
  });

  it('grows to the star-perceptual bloom extent when bright (bloom = 1)', () => {
    // A bright sub-pixel body blooms to the star appSize (reads like a
    // star of its magnitude); a resolved bright body keeps its larger
    // disc·OVERSIZE (the bloom never shrinks it below the disc).
    expect(glareSizePx(0.1, 24, 1)).toBe(24);
    expect(glareSizePx(100, 24, 1)).toBe(baseSize(100));
  });

  it('interpolates continuously across the bloom band (no pop)', () => {
    const b = baseSize(0.1);
    expect(glareSizePx(0.1, 24, 0.5)).toBeCloseTo(b + 0.5 * (24 - b), 10);
  });
});
