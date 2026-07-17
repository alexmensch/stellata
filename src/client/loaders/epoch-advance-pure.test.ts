import { describe, it, expect } from 'vitest';
import {
  CATALOG_SCENE_EPOCH_JYR,
  READVANCE_BUCKET_JYR,
  advancePositionsToEpoch,
  bucketEpochJyr,
  jdeToJulianEpochYear,
  maxSpeedPcPerYr,
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

  it('writes into a distinct out buffer, leaving the baseline untouched', () => {
    const base = new Float32Array([10, 20, 30]);
    const vel = new Float32Array([0.5, -0.25, 0.1]);
    const out = new Float32Array(3);
    advancePositionsToEpoch(base, vel, CATALOG_SCENE_EPOCH_JYR + 4, out);
    expect(Array.from(base)).toEqual([10, 20, 30]);
    expect(out[0]).toBeCloseTo(12, 5);
    expect(out[1]).toBeCloseTo(19, 5);
    expect(out[2]).toBeCloseTo(30.4, 5);
  });

  it('copies the baseline into out at the scene epoch (dt = 0)', () => {
    const base = new Float32Array([1, 2, 3]);
    const vel = new Float32Array([9, 9, 9]);
    const out = new Float32Array([-1, -1, -1]);
    advancePositionsToEpoch(base, vel, CATALOG_SCENE_EPOCH_JYR, out);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it('re-advancing the same out buffer from the baseline is idempotent — no double-advance', () => {
    const base = new Float32Array([10]);
    const vel = new Float32Array([1]);
    const out = new Float32Array(1);
    advancePositionsToEpoch(base, vel, CATALOG_SCENE_EPOCH_JYR + 100, out);
    advancePositionsToEpoch(base, vel, CATALOG_SCENE_EPOCH_JYR + 50, out);
    const fresh = new Float32Array(1);
    advancePositionsToEpoch(base, vel, CATALOG_SCENE_EPOCH_JYR + 50, fresh);
    expect(out[0]).toBe(fresh[0]);
    expect(out[0]).toBeCloseTo(60, 4);
  });
});

describe('bucketEpochJyr', () => {
  it('quantises onto the bucket grid', () => {
    expect(bucketEpochJyr(2026.5)).toBe(2026.5);
    expect(bucketEpochJyr(2026.51)).toBe(2026.5);
    expect(bucketEpochJyr(2026.53)).toBe(2026.55);
    expect(bucketEpochJyr(-2999.001)).toBe(-2999);
  });

  it('is idempotent on bucket values', () => {
    const b = bucketEpochJyr(1500.1234);
    expect(bucketEpochJyr(b)).toBe(b);
  });

  it('bucket width bounds the worst-case drift below an arcsecond-scale step', () => {
    // Barnard's Star, the fastest catalog PM (~10.4″/yr): one bucket of
    // drift stays ~0.5″ — sub-pixel at the tightest observe FOV.
    expect(READVANCE_BUCKET_JYR).toBe(0.05);
    expect(10.4 * READVANCE_BUCKET_JYR).toBeLessThan(1);
  });
});

describe('maxSpeedPcPerYr', () => {
  it('returns the largest per-record speed', () => {
    const vel = new Float32Array([
      1e-5, 0, 0,
      3e-4, -4e-4, 0, // |v| = 5e-4
      0, 0, 2e-4,
    ]);
    expect(maxSpeedPcPerYr(vel)).toBeCloseTo(5e-4, 9);
  });

  it('returns 0 for an all-static buffer', () => {
    expect(maxSpeedPcPerYr(new Float32Array(6))).toBe(0);
  });
});
