import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DWELL_FRAMES,
  VSYNC_CLAMP_IQR_MS,
  isVsyncClamped,
  summarizeFrameDwell,
} from './dwell-pure';

/** 1..20 ms, so every percentile lands on a value that is easy to name. */
const RAMP = Array.from({ length: 20 }, (_, i) => i + 1);

/** Alternating 16.67 ± 0.2 — the compositor's cadence, not frame cost. */
const VSYNC = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 16.47 : 16.87));

/** 30 ± 3, a frame genuinely over the vsync quantum. */
const OVER_BUDGET = Array.from({ length: 60 }, (_, i) => 30 + ((i % 3) - 1) * 3);

const HZ_60 = 1000 / 60;
const HZ_120 = 1000 / 120;

describe('summarizeFrameDwell', () => {
  it('returns null for an empty dwell rather than a zeroed summary', () => {
    expect(summarizeFrameDwell([], HZ_60)).toBeNull();
  });

  it('pins nearest-rank p50, p90 and p99', () => {
    const stats = summarizeFrameDwell(RAMP, HZ_60)!;
    expect(stats.samples).toBe(20);
    expect(stats.p50).toBe(10);
    expect(stats.p90).toBe(18);
    expect(stats.p99).toBe(20);
    expect(stats.iqrMs).toBe(10);
  });

  it('reports every percentile as an observed frame, never an interpolation', () => {
    const stats = summarizeFrameDwell([1, 2, 3, 4], HZ_60)!;
    expect(stats.p50).toBe(2);
    expect(RAMP).toContain(summarizeFrameDwell(RAMP, HZ_60)!.p50);
  });

  it('flags a dwell sitting on the measured cadence', () => {
    const stats = summarizeFrameDwell(VSYNC, HZ_60)!;
    expect(stats.iqrMs).toBeLessThan(VSYNC_CLAMP_IQR_MS);
    expect(stats.vsyncClamped).toBe(true);
  });

  it('does not flag a frame that is genuinely over budget', () => {
    expect(summarizeFrameDwell(OVER_BUDGET, HZ_60)!.vsyncClamped).toBe(false);
  });

  it('does not flag a tight dwell above the quantum, however narrow', () => {
    const tightButSlow = Array.from({ length: 60 }, () => 20);
    expect(summarizeFrameDwell(tightButSlow, HZ_60)!.vsyncClamped).toBe(false);
  });

  it('does not flag a fast dwell whose spread is wide', () => {
    const fastButWide = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 8 : 16));
    expect(summarizeFrameDwell(fastButWide, HZ_60)!.vsyncClamped).toBe(false);
  });

  it('reads alternation as negative lag-1 and a ramp as positive', () => {
    expect(summarizeFrameDwell(VSYNC, HZ_60)!.lag1).toBeLessThan(0);
    expect(summarizeFrameDwell(RAMP, HZ_60)!.lag1).toBeGreaterThan(0);
  });

  it('never clamps a GPU row, which no compositor can pad', () => {
    expect(summarizeFrameDwell(VSYNC, null)!.vsyncClamped).toBe(false);
  });
});

describe('isVsyncClamped — the cadence is measured, not assumed', () => {
  it('clamps at the cadence the runner actually saw', () => {
    expect(isVsyncClamped(HZ_60, 0.4, HZ_60)).toBe(true);
    expect(isVsyncClamped(HZ_120, 0.4, HZ_120)).toBe(true);
  });

  it('keeps a genuinely fast frame on an unthrottled display', () => {
    // The failure a fixed 60 Hz ceiling produced: headless Chromium hands
    // back a sub-millisecond idle period, so a real 6 ms frame was thrown
    // away as though a compositor it does not have had padded it.
    expect(isVsyncClamped(6, 0.4, 0.5)).toBe(false);
  });

  it('clamps a 12 ms dwell on a 60 Hz panel but not on a 120 Hz one', () => {
    expect(isVsyncClamped(12, 0.4, HZ_60)).toBe(true);
    expect(isVsyncClamped(12, 0.4, HZ_120)).toBe(false);
  });

  it('needs the spread as well as the level', () => {
    expect(isVsyncClamped(HZ_60, VSYNC_CLAMP_IQR_MS, HZ_60)).toBe(false);
  });

  it('reads nothing as clamped when no cadence was measured', () => {
    expect(isVsyncClamped(1, 0, null)).toBe(false);
    expect(isVsyncClamped(1, 0, 0)).toBe(false);
  });
});

describe('defaults', () => {
  it('dwells long enough for a percentile at the 99th to mean anything', () => {
    expect(DEFAULT_DWELL_FRAMES).toBe(240);
    expect(DEFAULT_DWELL_FRAMES * 0.01).toBeGreaterThanOrEqual(2);
  });
});
