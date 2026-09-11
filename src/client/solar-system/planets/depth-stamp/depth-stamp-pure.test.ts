import { describe, expect, it } from 'vitest';
import {
  DEPTH_STAMP_SHRINK,
  depthStampDrawn,
  depthStampRadius,
} from './depth-stamp-pure';
import { meshFadeFromPhysPx, MESH_FADE_FULL_PX, MESH_FADE_MIN_PX } from '../mesh-crossfade';

describe('the planet depth pre-stamp', () => {
  it('sits strictly inside the body mesh, by one part in a thousand', () => {
    expect(DEPTH_STAMP_SHRINK).toBe(1e-3);
    const r = 4.3e-10;
    expect(depthStampRadius(r)).toBeLessThan(r);
    expect(depthStampRadius(r)).toBeCloseTo(r * 0.999, 20);
  });

  it('stamps only a fully opaque mesh — never inside the crossfade band', () => {
    expect(depthStampDrawn(meshFadeFromPhysPx(MESH_FADE_FULL_PX))).toBe(true);
    expect(depthStampDrawn(meshFadeFromPhysPx(3000))).toBe(true);
    expect(depthStampDrawn(meshFadeFromPhysPx((MESH_FADE_MIN_PX + MESH_FADE_FULL_PX) / 2)))
      .toBe(false);
    expect(depthStampDrawn(meshFadeFromPhysPx(MESH_FADE_MIN_PX))).toBe(false);
    expect(depthStampDrawn(0)).toBe(false);
  });
});
