import { describe, expect, it } from 'vitest';
import {
  decodeDensity,
  type DustDecodeParams,
} from '../../../src/client/star-pipeline/extinction/dust-raymarch-pure';
import { percentile, strideSample, summarise, unclippedFixedMarch } from './march-taps-pure';

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
