import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DWELL_FRAMES,
  VSYNC_CLAMP_IQR_MS,
  VSYNC_CLAMP_P50_MS,
  summarizeFrameDwell,
} from './dwell-pure';

/** 1..20 ms, so every percentile lands on a value that is easy to name. */
const RAMP = Array.from({ length: 20 }, (_, i) => i + 1);

/** Alternating 16.67 ± 0.2 — the compositor's cadence, not frame cost. */
const VSYNC = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 16.47 : 16.87));

/** 30 ± 3, a frame genuinely over the vsync quantum. */
const OVER_BUDGET = Array.from({ length: 60 }, (_, i) => 30 + ((i % 3) - 1) * 3);

describe('summarizeFrameDwell', () => {
  it('returns null for an empty dwell rather than a zeroed summary', () => {
    expect(summarizeFrameDwell([])).toBeNull();
  });

  it('pins nearest-rank p50, p90 and p99', () => {
    const stats = summarizeFrameDwell(RAMP)!;
    expect(stats.samples).toBe(20);
    expect(stats.p50).toBe(10);
    expect(stats.p90).toBe(18);
    expect(stats.p99).toBe(20);
    expect(stats.iqrMs).toBe(10);
  });

  it('reports every percentile as an observed frame, never an interpolation', () => {
    const stats = summarizeFrameDwell([1, 2, 3, 4])!;
    expect(stats.p50).toBe(2);
    expect(RAMP).toContain(summarizeFrameDwell(RAMP)!.p50);
  });

  it('flags a vsync-clamped dwell', () => {
    const stats = summarizeFrameDwell(VSYNC)!;
    expect(stats.p50).toBeLessThan(VSYNC_CLAMP_P50_MS);
    expect(stats.iqrMs).toBeLessThan(VSYNC_CLAMP_IQR_MS);
    expect(stats.vsyncClamped).toBe(true);
  });

  it('does not flag a frame that is genuinely over budget', () => {
    expect(summarizeFrameDwell(OVER_BUDGET)!.vsyncClamped).toBe(false);
  });

  it('does not flag a tight dwell above the quantum, however narrow', () => {
    const tightButSlow = Array.from({ length: 60 }, () => 20);
    expect(summarizeFrameDwell(tightButSlow)!.vsyncClamped).toBe(false);
  });

  it('does not flag a fast dwell whose spread is wide', () => {
    const fastButWide = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 8 : 16));
    const stats = summarizeFrameDwell(fastButWide)!;
    expect(stats.p50).toBeLessThan(VSYNC_CLAMP_P50_MS);
    expect(stats.vsyncClamped).toBe(false);
  });

  it('reads alternation as negative lag-1 and a ramp as positive', () => {
    expect(summarizeFrameDwell(VSYNC)!.lag1).toBeLessThan(0);
    expect(summarizeFrameDwell(RAMP)!.lag1).toBeGreaterThan(0);
  });
});

describe('defaults', () => {
  it('dwells long enough for a percentile at the 99th to mean anything', () => {
    expect(DEFAULT_DWELL_FRAMES).toBe(240);
    expect(DEFAULT_DWELL_FRAMES * 0.01).toBeGreaterThanOrEqual(2);
  });
});
