import { describe, it, expect } from 'vitest';
import {
  CATALOG_SCENE_EPOCH_JYR,
  advancePositionsToEpoch,
  jdeToJulianEpochYear,
} from './epoch-advance-pure';

describe('jdeToJulianEpochYear', () => {
  it('maps J2000.0 and J2016.0 reference dates', () => {
    expect(jdeToJulianEpochYear(2451545.0)).toBe(2000.0);
    // J2016.0 = 2000 + 16 Julian years × 365.25 d.
    expect(jdeToJulianEpochYear(2451545.0 + 16 * 365.25)).toBeCloseTo(2016.0, 12);
  });
});

describe('advancePositionsToEpoch', () => {
  it('is a no-op at the scene epoch', () => {
    const pos = new Float32Array([1, 2, 3]);
    const vel = new Float32Array([1e-3, -2e-3, 5e-4]);
    advancePositionsToEpoch(pos, vel, CATALOG_SCENE_EPOCH_JYR);
    expect(Array.from(pos)).toEqual([1, 2, 3]);
  });

  it('advances p(t) = p(J2016) + v·Δt', () => {
    const pos = new Float32Array([10, 20, 30]);
    const vel = new Float32Array([0.5, -0.25, 0.1]);
    advancePositionsToEpoch(pos, vel, CATALOG_SCENE_EPOCH_JYR + 10);
    expect(pos[0]).toBeCloseTo(10 + 0.5 * 10, 4);
    expect(pos[1]).toBeCloseTo(20 - 0.25 * 10, 4);
    expect(pos[2]).toBeCloseTo(30 + 0.1 * 10, 4);
  });

  it('leaves zero-velocity records (Sol, no-PM rows) fixed', () => {
    const pos = new Float32Array([0, 0, 0, 5, -5, 5]);
    const vel = new Float32Array([0, 0, 0, 0, 0, 0]);
    advancePositionsToEpoch(pos, vel, CATALOG_SCENE_EPOCH_JYR + 50);
    expect(Array.from(pos)).toEqual([0, 0, 0, 5, -5, 5]);
  });

  it('advances backward for epochs before the scene epoch', () => {
    const pos = new Float32Array([100]);
    const vel = new Float32Array([2]);
    advancePositionsToEpoch(pos, vel, CATALOG_SCENE_EPOCH_JYR - 25);
    expect(pos[0]).toBeCloseTo(100 - 2 * 25, 4);
  });
});
