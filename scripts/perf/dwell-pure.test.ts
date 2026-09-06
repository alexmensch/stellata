import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DWELL_FRAMES,
  PASS_COUNTERS,
  STATE_GUARD_QUARTERS,
  STATE_GUARD_TREND_MS,
  quarterMedians,
  stateGuardVerdict,
  summarizeFrameDwell,
  summarizePassCounts,
} from './dwell-pure';
import { vsyncClampToleranceMs } from '../../src/client/debug/frame-cost/frame-cost-pure';

/** 1..20 ms, so every percentile lands on a value that is easy to name. */
const RAMP = Array.from({ length: 20 }, (_, i) => i + 1);

/** Alternating 16.67 ± 0.2 — the compositor's cadence, not frame cost. */
const VSYNC = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 16.47 : 16.87));

/** 30 ± 3, a frame genuinely over the vsync quantum. */
const OVER_BUDGET = Array.from({ length: 60 }, (_, i) => 30 + ((i % 3) - 1) * 3);

const HZ_60 = 1000 / 60;

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
    expect(stats.iqrMs).toBeLessThan(vsyncClampToleranceMs(HZ_60));
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

describe('state guard — a dwell that straddled the load transition', () => {
  it('reads four quarters in time order, each a nearest-rank median', () => {
    expect(STATE_GUARD_QUARTERS).toBe(4);
    expect(quarterMedians(RAMP)).toEqual([3, 8, 13, 18]);
    expect(quarterMedians([1, 2, 3])).toEqual([]);
  });

  it('calls a run wider than the trend threshold trending, either direction', () => {
    expect(STATE_GUARD_TREND_MS).toBe(1);
    expect(stateGuardVerdict([17.4, 18.2, 19.6, 21.0])).toBe('trending');
    expect(stateGuardVerdict([21.0, 19.6, 18.2, 17.4])).toBe('trending');
  });

  it('catches the power step, which is flat then flat higher rather than rising', () => {
    expect(stateGuardVerdict([16.9, 16.9, 21.8, 21.8])).toBe('trending');
    expect(stateGuardVerdict([21.8, 21.8, 21.8, 16.9])).toBe('trending');
    expect(stateGuardVerdict([17, 19, 18, 21])).toBe('trending');
  });

  it('calls a flat dwell and a sub-threshold drift steady', () => {
    expect(stateGuardVerdict([21, 21, 21, 21])).toBe('steady');
    expect(stateGuardVerdict([17.0, 17.2, 17.5, 17.9])).toBe('steady');
    expect(stateGuardVerdict([17.0, 17.2, 17.5, 18.0])).toBe('steady');
    expect(stateGuardVerdict([17.0, 17.2, 17.5, 18.1])).toBe('trending');
    expect(stateGuardVerdict([17.9, 17.0, 17.5, 17.2])).toBe('steady');
    expect(stateGuardVerdict([])).toBe('steady');
  });

  it('is carried on the summary', () => {
    expect(summarizeFrameDwell(RAMP, HZ_60)!.stateGuard).toBe('trending');
    expect(summarizeFrameDwell(RAMP, HZ_60)!.quarterMedians).toEqual([3, 8, 13, 18]);
    expect(summarizeFrameDwell(VSYNC, HZ_60)!.stateGuard).toBe('steady');
    expect(summarizeFrameDwell(OVER_BUDGET, HZ_60)!.stateGuard).toBe('steady');
  });
});

describe('summarizePassCounts', () => {
  it('names the four things a WebGPU frame is counted on', () => {
    expect(PASS_COUNTERS).toEqual(['submits', 'commandBuffers', 'renderPasses', 'computePasses']);
  });

  it('returns null for an empty dwell', () => {
    expect(summarizePassCounts({ submits: [], commandBuffers: [], renderPasses: [], computePasses: [] }))
      .toBeNull();
  });

  // A readback frame carries the reduction chain's extra passes, so the
  // per-frame count is bimodal: min and max are the two modes, p50 the
  // common one.
  it('reports min, nearest-rank p50 and max per counter', () => {
    const s = summarizePassCounts({
      submits: [3, 3, 3, 5],
      commandBuffers: [3, 3, 3, 5],
      renderPasses: [4, 4, 4, 12],
      computePasses: [0, 0, 0, 1],
    })!;
    expect(s.submits).toEqual({ min: 3, p50: 3, max: 5 });
    expect(s.renderPasses).toEqual({ min: 4, p50: 4, max: 12 });
    expect(s.computePasses).toEqual({ min: 0, p50: 0, max: 1 });
  });
});

describe('defaults', () => {
  it('dwells long enough for a percentile at the 99th to mean anything', () => {
    expect(DEFAULT_DWELL_FRAMES).toBe(240);
    expect(DEFAULT_DWELL_FRAMES * 0.01).toBeGreaterThanOrEqual(2);
  });
});
