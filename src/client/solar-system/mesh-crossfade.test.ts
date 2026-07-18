import { describe, expect, it } from 'vitest';

import {
  MESH_FADE_END_PX,
  MESH_FADE_START_PX,
  meshFade,
  physicalDiameterPx,
  TEXTURE_PREFETCH_PX,
} from './mesh-crossfade';

const KM_PC = 1 / 3.0857e13;
const AU_PC = 1 / 206264.806;

describe('physicalDiameterPx', () => {
  it('matches θ = 2·atan(R/d) through the vertical FOV', () => {
    // Earth (R = 6371 km) from 1000 Earth radii, 50° FOV, 1000 px tall.
    const R = 6371 * KM_PC;
    const d = R * 1000;
    const fov = (50 * Math.PI) / 180;
    const px = physicalDiameterPx(R, d, fov, 1000);
    expect(px).toBeCloseTo(2 * Math.atan(1 / 1000) * (1000 / fov), 10);
  });

  it('is sub-prefetch at disc-regime distances and past the band up close', () => {
    const R = 6371 * KM_PC;
    const fov = (50 * Math.PI) / 180;
    // From 1 AU Earth is far below the prefetch threshold…
    expect(physicalDiameterPx(R, AU_PC, fov, 1000)).toBeLessThan(TEXTURE_PREFETCH_PX);
    // …and from 20 Earth radii it is far past the fade band.
    expect(physicalDiameterPx(R, R * 20, fov, 1000)).toBeGreaterThan(MESH_FADE_END_PX);
  });

  it('returns 0 for degenerate inputs', () => {
    expect(physicalDiameterPx(1, 0, 1, 1000)).toBe(0);
    expect(physicalDiameterPx(1, -1, 1, 1000)).toBe(0);
    expect(physicalDiameterPx(1, 1, 0, 1000)).toBe(0);
  });
});

describe('meshFade', () => {
  it('is 0 below the band and 1 above it', () => {
    expect(meshFade(0)).toBe(0);
    expect(meshFade(MESH_FADE_START_PX)).toBe(0);
    expect(meshFade(MESH_FADE_END_PX)).toBe(1);
    expect(meshFade(500)).toBe(1);
  });

  it('is smooth and monotonic across the band', () => {
    const mid = (MESH_FADE_START_PX + MESH_FADE_END_PX) / 2;
    expect(meshFade(mid)).toBeCloseTo(0.5, 10);
    let prev = -1;
    for (let px = 0; px <= MESH_FADE_END_PX + 10; px += 0.5) {
      const f = meshFade(px);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});
