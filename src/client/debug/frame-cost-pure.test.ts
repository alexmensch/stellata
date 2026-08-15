import { describe, it, expect } from 'vitest';
import {
  median,
  percentile,
  summarizeDwell,
  differentialNoiseMs,
  buildPriceRow,
} from './frame-cost-pure';

describe('frame-cost-pure', () => {
  it('median: odd, even, single', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('percentile: nearest-rank, clamped at both ends', () => {
    const xs = [10, 20, 30, 40];
    expect(percentile(xs, 0.25)).toBe(10);
    expect(percentile(xs, 0.75)).toBe(30);
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 1)).toBe(40);
  });

  it('summarizeDwell: empty is null, stats otherwise', () => {
    expect(summarizeDwell([])).toBeNull();
    expect(summarizeDwell([1, 2, 3, 4])).toEqual({
      samples: 4,
      medianMs: 2.5,
      iqrMs: 2,
    });
  });

  it('one hitched frame moves the spread but not the noise floor', () => {
    const steady = Array.from({ length: 120 }, (_, i) => 20 + (i % 4));
    const hitched = [...steady.slice(1), 900];
    const a = summarizeDwell(steady)!;
    const b = summarizeDwell(hitched)!;
    expect(b.iqrMs).toBe(a.iqrMs);
    expect(differentialNoiseMs(a, b)).toBeCloseTo(differentialNoiseMs(a, a), 6);
  });

  it('noise floor stays well under a real differential at dwell length', () => {
    const baseline = summarizeDwell(
      Array.from({ length: 120 }, (_, i) => 137 + (i % 20)),
    )!;
    const disabled = summarizeDwell(
      Array.from({ length: 120 }, (_, i) => 127 + (i % 20)),
    )!;
    const row = buildPriceRow('localDepth', 'timer-query', baseline, disabled);
    expect(row.savedMs).toBe(10);
    expect(row.noiseMs).toBeLessThan(2);
    expect(row.iqrMs).toBe(10);
  });

  it('buildPriceRow differences medians and reports the wider IQR', () => {
    const baseline = { samples: 100, medianMs: 20, iqrMs: 3 };
    const disabled = { samples: 90, medianMs: 14, iqrMs: 8 };
    const row = buildPriceRow('localDepth', 'timer-query', baseline, disabled);
    expect(row.savedMs).toBe(6);
    expect(row.savedPct).toBe(30);
    expect(row.samples).toBe(90);
    expect(row.iqrMs).toBe(8);
    expect(row.method).toBe('timer-query');
  });

  it('buildPriceRow: negative differential survives (a pass that got cheaper when enabled)', () => {
    const baseline = { samples: 10, medianMs: 10, iqrMs: 2 };
    const disabled = { samples: 10, medianMs: 12, iqrMs: 2 };
    expect(buildPriceRow('x', 'raf-delta', baseline, disabled).savedMs).toBe(-2);
  });

  it('buildPriceRow: zero baseline yields 0 pct, not NaN', () => {
    const zero = { samples: 5, medianMs: 0, iqrMs: 0 };
    expect(buildPriceRow('x', 'timer-query', zero, zero).savedPct).toBe(0);
    expect(buildPriceRow('x', 'timer-query', zero, zero).noiseMs).toBe(0);
  });
});
