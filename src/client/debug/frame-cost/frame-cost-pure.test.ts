import { describe, it, expect } from 'vitest';
import {
  median,
  percentile,
  summarizeDwell,
  differentialNoiseMs,
  lag1Autocorrelation,
  buildPriceRow,
  buildInterleavedRow,
  fitDwellFrames,
} from './frame-cost-pure';

const FIT = {
  dwellFrames: 120,
  settleFrames: 30,
  minDwellFrames: 30,
};

const dwell = (
  samples: number,
  medianMs: number,
  iqrMs: number,
  lag1 = 0,
  readbackPerFrame = 0,
  effectiveLimitMag = 0,
) => ({ samples, medianMs, iqrMs, lag1, readbackPerFrame, effectiveLimitMag });

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
    expect(
      summarizeDwell([1, 2, 3, 4], { readbackPerFrame: 0.5, effectiveLimitMag: 12.5 }),
    ).toEqual({
      samples: 4,
      medianMs: 2.5,
      iqrMs: 2,
      lag1: 0.25,
      readbackPerFrame: 0.5,
      effectiveLimitMag: 12.5,
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
    const baseline = dwell(100, 20, 3);
    const disabled = dwell(90, 14, 8);
    const row = buildPriceRow('localDepth', 'timer-query', baseline, disabled);
    expect(row.savedMs).toBe(6);
    expect(row.savedPct).toBe(30);
    expect(row.samples).toBe(90);
    expect(row.iqrMs).toBe(8);
    expect(row.method).toBe('timer-query');
  });

  it('buildPriceRow: negative differential survives (a pass that got cheaper when enabled)', () => {
    expect(
      buildPriceRow('x', 'raf-delta', dwell(10, 10, 2), dwell(10, 12, 2)).savedMs,
    ).toBe(-2);
  });

  it('bracketing cancels linear drift a single baseline charges to the pass', () => {
    // The instrument walks 60 -> 50 ms across the three dwells; the pass
    // itself is free.
    const before = dwell(120, 60, 4);
    const disabled = dwell(120, 55, 4);
    const after = dwell(120, 50, 4);

    expect(buildPriceRow('free', 'timer-query', before, disabled).savedMs).toBe(5);
    expect(
      buildInterleavedRow('free', 'timer-query', before, after, disabled).savedMs,
    ).toBe(0);
  });

  it('interleaved row reports the bracket the measurement sat in', () => {
    const row = buildInterleavedRow(
      'hdrChain',
      'timer-query',
      dwell(120, 50, 6),
      dwell(120, 42, 6),
      dwell(120, 9, 2),
    );
    expect(row.baselineMs).toBe(46);
    expect(row.savedMs).toBe(37);
    expect(row.bracketMs).toBe(8);
    expect(row.iqrMs).toBe(6);
  });

  it('a single-baseline row carries no bracket', () => {
    const stats = dwell(10, 10, 1);
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

  it('lag1: frame-to-frame alternation reads strongly negative', () => {
    const alternating = Array.from({ length: 8 }, (_, i) => (i % 2 ? 30 : 20));
    expect(lag1Autocorrelation(alternating)).toBe(-0.875);
  });

  it('lag1: drift within a dwell reads positive, and a flat dwell reads zero', () => {
    expect(lag1Autocorrelation([1, 2, 3, 4, 5, 6, 7, 8])).toBe(0.625);
    expect(lag1Autocorrelation([5, 5, 5, 5, 5, 5])).toBe(0);
  });

  it('lag1: too few samples to have a lag read zero', () => {
    expect(lag1Autocorrelation([])).toBe(0);
    expect(lag1Autocorrelation([10, 20])).toBe(0);
  });

  it('lag1: one hitched frame cannot hide alternation (ranks, not magnitudes)', () => {
    const alternating = Array.from({ length: 120 }, (_, i) => (i % 2 ? 30 : 20));
    const hitched = [...alternating.slice(1), 900];
    expect(lag1Autocorrelation(hitched)).toBeLessThan(-0.9);
  });

  it('a row carries both dwells lag1, so a zero row can be told from a noisy one', () => {
    const row = buildInterleavedRow(
      'reduction',
      'timer-query',
      dwell(120, 50, 12, -0.9),
      dwell(120, 48, 12, -0.8),
      dwell(120, 40, 3, -0.1),
    );
    expect(row.baselineLag1).toBe(-0.85);
    expect(row.disabledLag1).toBe(-0.1);
  });

  it('a row carries the readback cadence each state actually ran at', () => {
    // The fence is the frame's only ANGLE submission barrier, so a row
    // whose two rates differ priced a change in barrier rate on top of the
    // pass — the reduction row at a frame-time-limited viewpoint.
    const row = buildInterleavedRow(
      'reduction',
      'timer-query',
      dwell(120, 155, 94, 0.06, 0.48),
      dwell(120, 155, 94, 0.06, 0.52),
      dwell(120, 193, 94, 0.06, 0.97),
    );
    expect(row.baselineReadback).toBe(0.5);
    expect(row.disabledReadback).toBe(0.97);
  });

  it('a row carries what each state drew, not just how long it took', () => {
    // A toggle that moves the adaptation cut changes the scene, so the
    // differential prices a different frame rather than the pass.
    const row = buildInterleavedRow(
      'reduction',
      'timer-query',
      dwell(120, 96, 48, 0, 0.25, 14.2),
      dwell(120, 96, 48, 0, 0.25, 14.2),
      dwell(120, 112, 48, 0, 0.25, 15.6),
    );
    expect(row.baselineLimitMag).toBe(14.2);
    expect(row.disabledLimitMag).toBe(15.6);
  });

  it('buildPriceRow: zero baseline yields 0 pct, not NaN', () => {
    const zero = dwell(5, 0, 0);
    expect(buildPriceRow('x', 'timer-query', zero, zero).savedPct).toBe(0);
    expect(buildPriceRow('x', 'timer-query', zero, zero).noiseMs).toBe(0);
  });
});
