import { describe, it, expect } from 'vitest';
import {
  median,
  percentile,
  summarizeDwell,
  differentialNoiseMs,
  buildPriceRow,
  buildInterleavedRow,
  fitDwellFrames,
} from './frame-cost-pure';

const FIT = {
  dwellFrames: 120,
  settleFrames: 30,
  minDwellFrames: 30,
};

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

  it('bracketing cancels linear drift a single baseline charges to the pass', () => {
    // The instrument walks 60 -> 50 ms across the three dwells; the pass
    // itself is free.
    const before = { samples: 120, medianMs: 60, iqrMs: 4 };
    const disabled = { samples: 120, medianMs: 55, iqrMs: 4 };
    const after = { samples: 120, medianMs: 50, iqrMs: 4 };

    expect(buildPriceRow('free', 'timer-query', before, disabled).savedMs).toBe(5);
    expect(
      buildInterleavedRow('free', 'timer-query', before, after, disabled).savedMs,
    ).toBe(0);
  });

  it('interleaved row reports the bracket the measurement sat in', () => {
    const row = buildInterleavedRow(
      'hdrChain',
      'timer-query',
      { samples: 120, medianMs: 50, iqrMs: 6 },
      { samples: 120, medianMs: 42, iqrMs: 6 },
      { samples: 120, medianMs: 9, iqrMs: 2 },
    );
    expect(row.baselineMs).toBe(46);
    expect(row.savedMs).toBe(37);
    expect(row.bracketMs).toBe(8);
    expect(row.iqrMs).toBe(6);
  });

  it('a single-baseline row carries no bracket', () => {
    const stats = { samples: 10, medianMs: 10, iqrMs: 1 };
    expect(buildPriceRow('x', 'timer-query', stats, stats).bracketMs).toBeUndefined();
  });

  it('fitDwellFrames: a sweep that already fits is left alone', () => {
    // 150 frames at 5 ms = 750 ms per dwell, 16 dwells = 12 s.
    const fit = fitDwellFrames({
      ...FIT,
      firstDwellMs: 750,
      remainingDwells: 16,
      affordableMs: 180_000,
    });
    expect(fit.frames).toBe(120);
    expect(fit.shortened).toBe(false);
    expect(fit.willTruncate).toBe(false);
  });

  it('fitDwellFrames: the default Sol view shortens rather than truncates', () => {
    // 150 frames at ~120 ms = 18 s per dwell; 16 more dwells is ~288 s
    // against a 180 s budget.
    const fit = fitDwellFrames({
      ...FIT,
      firstDwellMs: 18_000,
      remainingDwells: 16,
      affordableMs: 180_000,
    });
    expect(fit.shortened).toBe(true);
    expect(fit.willTruncate).toBe(false);
    expect(fit.frames).toBeGreaterThanOrEqual(FIT.minDwellFrames);
    expect(fit.frames).toBeLessThan(120);
    // What it picked must actually fit.
    expect(
      16 * (fit.frames + FIT.settleFrames) * fit.perFrameMs,
    ).toBeLessThanOrEqual(180_000);
  });

  it('fitDwellFrames: flags truncation when even the floor cannot fit', () => {
    const fit = fitDwellFrames({
      ...FIT,
      firstDwellMs: 60_000,
      remainingDwells: 16,
      affordableMs: 30_000,
    });
    expect(fit.willTruncate).toBe(true);
    expect(fit.frames).toBe(FIT.minDwellFrames);
  });

  it('fitDwellFrames: no remaining dwells and zero-cost frames are no-ops', () => {
    expect(
      fitDwellFrames({ ...FIT, firstDwellMs: 9e9, remainingDwells: 0, affordableMs: 1 })
        .frames,
    ).toBe(120);
    expect(
      fitDwellFrames({ ...FIT, firstDwellMs: 0, remainingDwells: 16, affordableMs: 1 })
        .frames,
    ).toBe(120);
  });

  it('buildPriceRow: zero baseline yields 0 pct, not NaN', () => {
    const zero = { samples: 5, medianMs: 0, iqrMs: 0 };
    expect(buildPriceRow('x', 'timer-query', zero, zero).savedPct).toBe(0);
    expect(buildPriceRow('x', 'timer-query', zero, zero).noiseMs).toBe(0);
  });
});
