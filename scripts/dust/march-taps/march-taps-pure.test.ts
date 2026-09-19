import { describe, expect, it } from 'vitest';
import {
  DUST_TAPS_MAX,
  decodeDensity,
  dustRaymarchAv,
  type DustDecodeParams,
  type Vec3,
} from '../../../src/client/star-pipeline/extinction/dust-raymarch-pure';
import {
  FIXED_MARCH_TAPS, fp32March, percentile, strideSample, summarise, unclippedFixedMarch,
} from './march-taps-pure';

const P: DustDecodeParams = {
  boundsPc: 1250,
  densityMin: 1e-7,
  logRatio: Math.log(0.2 / 1e-7),
  avPerDensityPc: 2.742,
};

describe('percentile / summarise', () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1);

  it('is nearest-rank', () => {
    expect(percentile(sorted, 0.5)).toBe(50);
    expect(percentile(sorted, 0.9)).toBe(90);
    expect(percentile(sorted, 0.99)).toBe(99);
    expect(percentile([7], 0.99)).toBe(7);
    expect(percentile([], 0.5)).toBeNaN();
  });

  it('summarises an unsorted sample', () => {
    expect(summarise([...sorted].reverse())).toEqual({ p50: 50, p90: 90, p99: 99, max: 100 });
  });
});

describe('strideSample', () => {
  it('spreads n indices over the count and never repeats', () => {
    expect(strideSample(10, 5)).toEqual([0, 2, 4, 6, 8]);
    expect(strideSample(3, 10)).toEqual([0, 1, 2]);
  });
});

describe('unclippedFixedMarch', () => {
  it('matches the closed form for a uniform in-cube segment', () => {
    const av = unclippedFixedMarch([0, 0, 0], [100, 0, 0], () => 0.85, P, 48);
    expect(av).toBeCloseTo(decodeDensity(0.85, P) * 100 * P.avPerDensityPc, 9);
  });

  it('spends taps outside the cube: 30 of 48 land inside on a ±2000 pc segment', () => {
    const av = unclippedFixedMarch([-2000, 0, 0], [2000, 0, 0], () => 0.85, P, 48);
    expect(av).toBeCloseTo(155.5546347497444, 8);
  });
});

describe('the frozen yardstick', () => {
  it('is 48, and does not move when the tap rule is retuned', () => {
    expect(FIXED_MARCH_TAPS).toBe(48);
  });
});

describe('fp32March', () => {
  // A ramp, so a displaced tap reads a different value rather than the same
  // one — a constant field would pass at any precision.
  const ramp = (u: number) => Math.min(1, Math.max(0, u));
  const both = (from: Vec3, to: Vec3): [number, number] => [
    dustRaymarchAv(from, to, ramp, P),
    fp32March(from, to, ramp, P),
  ];

  it('tracks the double-precision march from inside the cube', () => {
    const [f64, f32] = both([0, 0, 0], [400, 120, -60]);
    expect(f32).toBeCloseTo(f64, 5);
  });

  it('still tracks it from a megaparsec out, where the clip arithmetic cancels', () => {
    // Every tap here lands inside the cube after a subtraction of two
    // ~1e6 pc quantities — the case single precision is worst at.
    const [f64, f32] = both([0, 1e6, 0], [300, -800, 120]);
    expect(f32).toBeCloseTo(f64, 2);
    expect(Math.abs(f32 - f64)).toBeLessThan(0.05);
  });

  it('spends the shipped tap count, cap included', () => {
    // A full diagonal crossing runs past DUST_TAP_PC × DUST_TAPS_MAX.
    let taps = 0;
    fp32March([-1200, -1200, -1200], [1200, 1200, 1200], (u) => {
      taps++;
      return ramp(u);
    }, P);
    expect(taps).toBe(DUST_TAPS_MAX);
  });

  it('returns zero on a segment that never enters the cube', () => {
    expect(fp32March([2000, 2000, 2000], [3000, 3000, 3000], ramp, P)).toBe(0);
  });
});
