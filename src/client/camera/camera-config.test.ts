// camera-config tests — shipped defaults, override visibility to
// production readers, and the capture-at-resolve-time arrival curve.

import { describe, it, expect, afterEach } from 'vitest';
import {
  ARRIVAL_HYBRID_SEAM_K,
  MID_FLY_RECENTRE_FRAC,
  arrivalEaseFn,
  cameraConfig,
  setCameraConfig,
  type CameraConfig,
} from './camera-config';
import {
  OBSERVE_TRANSITION_MS,
  WARP_REORIENT_MS,
  WARP_T_K_MS,
  WARP_T_MAX_MS,
  WARP_T_MIN_MS,
} from './timing';

const SHIPPED: CameraConfig = {
  reorientMs: WARP_REORIENT_MS,
  flyTMinMs: WARP_T_MIN_MS,
  flyTMaxMs: WARP_T_MAX_MS,
  flyTKMs: WARP_T_K_MS,
  observeTransitionMs: OBSERVE_TRANSITION_MS,
  arrivalHybridSeamK: ARRIVAL_HYBRID_SEAM_K,
  midFlyRecentreFrac: MID_FLY_RECENTRE_FRAC,
};

function restoreShipped(): void {
  for (const key of Object.keys(SHIPPED) as Array<keyof CameraConfig>) {
    setCameraConfig(key, SHIPPED[key]);
  }
}

afterEach(restoreShipped);

describe('cameraConfig defaults', () => {
  it('ships the timing.ts constants — a build that never opens the debug panel behaves identically', () => {
    expect(cameraConfig()).toEqual(SHIPPED);
  });

  it('pins the two config-owned constants', () => {
    expect(ARRIVAL_HYBRID_SEAM_K).toBe(100);
    expect(MID_FLY_RECENTRE_FRAC).toBe(0.5);
  });
});

describe('setCameraConfig', () => {
  it('is visible to a reader that calls cameraConfig() after the write', () => {
    setCameraConfig('reorientMs', 400);
    expect(cameraConfig().reorientMs).toBe(400);
  });

  it('is visible through an accessor captured before the write — production reads dereference per warp', () => {
    const cfg = cameraConfig();
    setCameraConfig('flyTMaxMs', 1234);
    expect(cfg.flyTMaxMs).toBe(1234);
  });

  it('leaves the other fields alone', () => {
    setCameraConfig('midFlyRecentreFrac', 0.8);
    expect(cameraConfig()).toEqual({ ...SHIPPED, midFlyRecentreFrac: 0.8 });
  });
});

describe('arrivalEaseFn', () => {
  const ctx = { d0: 100, dEnd: 1e-3, targetRadius: 1e-4 };

  it('spans u=0 → f=0 and u=1 → f=1 on the shipped seam', () => {
    const f = arrivalEaseFn(ctx);
    expect(f(0)).toBeCloseTo(0, 12);
    expect(f(1)).toBeCloseTo(1, 12);
  });

  it('captures the seam multiplier at resolve time — a later write does not mutate the in-flight curve', () => {
    const inFlight = arrivalEaseFn(ctx);
    const before = inFlight(0.5);
    setCameraConfig('arrivalHybridSeamK', 1);
    expect(inFlight(0.5)).toBe(before);
    expect(arrivalEaseFn(ctx)(0.5)).not.toBe(before);
  });

  it('falls back to cubic-Hermite with no context (clouds, outbound)', () => {
    const f = arrivalEaseFn();
    expect(f(0.5)).toBeCloseTo(0.5, 12);
    expect(f(0.25)).toBeCloseTo(3 * 0.0625 - 2 * 0.015625, 12);
  });
});
