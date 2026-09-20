import { describe, expect, it } from 'vitest';
import {
  CLASS_GAP_OVER_MEDIAN,
  DEFAULT_DWELL_FRAMES,
  DWELL_READBACK_EVERY_FRAMES,
  PASS_COUNTERS,
  STATE_GUARD_QUARTERS,
  STATE_GUARD_TREND_MS,
  classClock,
  gatingClock,
  quarterMedians,
  readbackCadenceHeld,
  sampleClasses,
  stateGuardVerdict,
  summarizeFrameDwell,
  summarizePassCounts,
} from './dwell-pure';
import { interquartileRange, vsyncClampToleranceMs } from '../../../src/client/debug/frame-cost/frame-cost-pure';

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

describe('gatingClock — which clock a gate may act on', () => {
  const wall = summarizeFrameDwell(RAMP, HZ_60)!;
  const gpu = summarizeFrameDwell(VSYNC, null)!;

  it('is the GPU stream wherever the row has one', () => {
    expect(gatingClock({ stats: wall, gpuStats: gpu }).clock).toBe(gpu);
    expect(gatingClock({ stats: wall, gpuStats: gpu }).clock.stateGuard).toBe('steady');
  });

  it('falls back to wall only where there is no GPU stream', () => {
    expect(gatingClock({ stats: wall, gpuStats: null }).clock).toBe(wall);
    expect(gatingClock({ stats: wall, gpuStats: null }).clock.stateGuard).toBe('trending');
  });

  // The metric comes back with the clock so that no caller can name one and
  // read the other: both gates print it, and a table saying gpu-p50 over a
  // wall median is the one error neither of them could detect.
  it('names the clock it returned', () => {
    expect(gatingClock({ stats: wall, gpuStats: gpu }).metric).toBe('gpu-p50');
    expect(gatingClock({ stats: wall, gpuStats: null }).metric).toBe('wall-p50');
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

  it('pins the readback at the rate every clean earth dwell in the archive ran at', () => {
    expect(DWELL_READBACK_EVERY_FRAMES).toBe(4);
    expect(1 / DWELL_READBACK_EVERY_FRAMES).toBe(0.25);
  });
});

describe('the pinned readback cadence held', () => {
  const frames = DEFAULT_DWELL_FRAMES;
  const held = (readbacks: number, every = DWELL_READBACK_EVERY_FRAMES) =>
    readbackCadenceHeld(readbacks / frames, frames, every);

  it('admits the cap, and the one more the dwell\'s own count window straddles', () => {
    expect(held(60)).toBe(true);
    expect(held(61)).toBe(true);
    expect(held(62)).toBe(false);
  });

  // The window is frames + 2, so a cadence that DIVIDES the frame count keeps
  // a frame of margin instead of sitting on the bound. Measured at one-in-two
  // over 1200 frames: 601 requests issued, which the narrower window called
  // the maximum exactly and one phase shift would have refused.
  it('leaves a frame of margin where the cadence divides the frame count', () => {
    expect(readbackCadenceHeld(601 / 1200, 1200, 2)).toBe(true);
    expect(readbackCadenceHeld(602 / 1200, 1200, 2)).toBe(true);
    expect(readbackCadenceHeld(603 / 1200, 1200, 2)).toBe(false);
    expect(readbackCadenceHeld(300 / 1200, 1200, 4)).toBe(true);
    expect(readbackCadenceHeld(302 / 1200, 1200, 4)).toBe(false);
  });

  // One-in-one admits every frame, so the window itself is the only cap.
  it('admits the whole window at one-in-one, which caps nothing', () => {
    expect(readbackCadenceHeld(1, 240, 1)).toBe(true);
    expect(held(234, 1)).toBe(true);
  });

  it('admits a rate UNDER the cap: a round trip past the cadence is sound', () => {
    expect(held(40)).toBe(true);
    expect(held(0)).toBe(true);
  });

  it('reads the emergent rate as the lever not having taken', () => {
    // 0.579/frame — the duty cycle that put the earth GPU-stream median at
    // 52.854 ms against 17.157 at 0.25 (README.md).
    expect(held(139)).toBe(false);
    expect(held(234, 1)).toBe(true);
  });
});

describe('sampleClasses — the two classes a split frame draws', () => {
  // earth's own shape: ordinary frames near 12 ms, exposure-readback frames
  // near 75, a gap of ~60 against a lower median of 12.9.
  const EARTH = [12.0, 12.4, 12.9, 13.1, 13.4, 74.2, 75.6, 77.1];

  it('cuts at the widest gap and keeps both classes', () => {
    const classes = sampleClasses(EARTH);
    expect(classes).not.toBeNull();
    expect(classes!.plain).toEqual([12.0, 12.4, 12.9, 13.1, 13.4]);
    expect(classes!.dear).toEqual([74.2, 75.6, 77.1]);
    expect(classes!.cutMs).toBeCloseTo(43.8, 6);
  });

  it('sorts the samples, so the cut does not depend on the order they arrived', () => {
    const shuffled = [75.6, 12.4, 77.1, 13.4, 12.0, 74.2, 13.1, 12.9];
    expect(sampleClasses(shuffled)).toEqual(sampleClasses(EARTH));
  });

  it('finds nothing in two overlapping modes, however far apart their centres', () => {
    const overlapping = [0.36, 0.38, 0.39, 0.41, 0.45, 0.50, 0.55, 0.58, 0.60, 0.62];
    expect(sampleClasses(overlapping)).toBeNull();
  });

  it('finds nothing in one population, and nothing in too few samples to hold two', () => {
    expect(sampleClasses([18.9, 19.0, 19.1, 19.2, 19.4])).toBeNull();
    expect(sampleClasses([12.0])).toBeNull();
    expect(sampleClasses(null)).toBeNull();
  });

  it('holds the gap rule at the ratio the constant names', () => {
    expect(CLASS_GAP_OVER_MEDIAN).toBe(1);
    // Strictly past, so the smallest pair separated is one class costing
    // more than twice the other — well under earth's own 4×.
    expect(sampleClasses([10, 10, 20])).toBeNull();
    expect(sampleClasses([10, 10, 20.1])).not.toBeNull();
  });

  it('gives classClock the three fields a band is built from', () => {
    const plain = [12.0, 12.4, 12.9, 13.1, 13.4];
    expect(classClock(plain)).toEqual({ p50: 12.9, iqrMs: interquartileRange(plain), samples: 5 });
  });
});
