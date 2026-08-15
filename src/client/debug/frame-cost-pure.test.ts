import { describe, it, expect } from 'vitest';
import { median, summarizeDwell, buildPriceRow } from './frame-cost-pure';

describe('frame-cost-pure', () => {
  it('median: odd, even, single', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });

  it('summarizeDwell: empty is null, stats otherwise', () => {
    expect(summarizeDwell([])).toBeNull();
    expect(summarizeDwell([2, 8, 5])).toEqual({
      samples: 3,
      medianMs: 5,
      minMs: 2,
      maxMs: 8,
    });
  });

  it('buildPriceRow differences medians and reports the wider spread', () => {
    const baseline = { samples: 100, medianMs: 20, minMs: 19, maxMs: 22 };
    const disabled = { samples: 90, medianMs: 14, minMs: 13, maxMs: 21 };
    const row = buildPriceRow('localDepth', 'timer-query', baseline, disabled);
    expect(row.savedMs).toBe(6);
    expect(row.savedPct).toBe(30);
    expect(row.samples).toBe(90);
    expect(row.spreadMs).toBe(8);
    expect(row.method).toBe('timer-query');
  });

  it('buildPriceRow: negative differential survives (a pass that got cheaper when enabled)', () => {
    const baseline = { samples: 10, medianMs: 10, minMs: 9, maxMs: 11 };
    const disabled = { samples: 10, medianMs: 12, minMs: 11, maxMs: 13 };
    expect(buildPriceRow('x', 'raf-delta', baseline, disabled).savedMs).toBe(-2);
  });

  it('buildPriceRow: zero baseline yields 0 pct, not NaN', () => {
    const zero = { samples: 5, medianMs: 0, minMs: 0, maxMs: 0 };
    expect(buildPriceRow('x', 'timer-query', zero, zero).savedPct).toBe(0);
  });
});
