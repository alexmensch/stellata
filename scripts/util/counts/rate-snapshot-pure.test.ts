import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RATE_TOLERANCE, compareRateSnapshot, compareRates, rateEntries, refreshedRates, type RateSnapshot,
} from './rate-snapshot-pure';

const committed: RateSnapshot = {
  stages: { resolve: { r: { value: 0.5, tolerance: 0.1 } }, orbits: { s: { value: 0.25, tolerance: 0.2 } } },
};

describe('rateEntries', () => {
  it('keeps each rate unrounded under the default tolerance', () => {
    expect(rateEntries({ stages: { resolve: { r: 0.123456789 } } })).toEqual({
      stages: { resolve: { r: { value: 0.123456789, tolerance: DEFAULT_RATE_TOLERANCE } } },
    });
  });
});

describe('refreshedRates', () => {
  it('rounds each value to six decimals and keeps a committed tolerance', () => {
    const actual = rateEntries({ stages: { resolve: { r: 0.4554444444 }, optical: { t: 1 / 3 } } });
    expect(refreshedRates(committed, actual)).toEqual({
      stages: { resolve: { r: { value: 0.455444, tolerance: 0.1 } }, optical: { t: { value: 0.333333, tolerance: DEFAULT_RATE_TOLERANCE } } },
    });
  });

  it('writes the default tolerance on a first refresh', () => {
    expect(refreshedRates(null, rateEntries({ stages: { resolve: { r: 0.5 } } }))).toEqual({
      stages: { resolve: { r: { value: 0.5, tolerance: DEFAULT_RATE_TOLERANCE } } },
    });
  });
});

describe('compareRates', () => {
  const actual = (r: number, s = 0.25): RateSnapshot => rateEntries({ stages: { resolve: { r }, orbits: { s } } });

  it('matches within the committed tolerance, relative to the committed value', () => {
    expect(compareRateSnapshot(committed, actual(0.549)).drifted).toBe(false);
    expect(compareRates(committed, actual(0.5501)).find((d) => d.key === 'r')?.status).toBe('drift');
  });

  it('compares the unrounded rate', () => {
    expect(compareRates(committed, actual(0.4499999)).find((d) => d.key === 'r')?.status).toBe('drift');
  });

  it('reports a rate either side lacks, and one filed under another stage', () => {
    const moved = rateEntries({ stages: { resolve: { r: 0.5, s: 0.25 }, optical: { t: 0.1 } } });
    expect(compareRates(committed, moved).filter((d) => d.status !== 'match').map((d) => [d.key, d.status])).toEqual([
      ['s', 'moved'], ['t', 'absent-from-snapshot'],
    ]);
    expect(compareRates(committed, rateEntries({ stages: { resolve: { r: 0.5 } } })).at(-1)).toMatchObject({ key: 's', status: 'absent-from-build' });
  });

  it('names each drifted rate with its tolerance', () => {
    expect(compareRateSnapshot(committed, actual(0.7)).report).toBe('rates: 1 of 2 rates drifted\n  r expected 0.5000 ± 10%, got 0.7000');
    expect(compareRateSnapshot(committed, actual(0.5)).report).toBe('rates: all 2 rates within tolerance');
  });
});
