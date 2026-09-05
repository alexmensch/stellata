import { describe, expect, it } from 'vitest';
import type { PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost-pure';
import type { DwellSummary } from './dwell-pure';
import type { RunDiff } from './diff-pure';
import type { SweepPoint } from './sweep-pure';
import type { DwellRecord } from './schema';
import {
  PRICE_ROW_COLUMNS,
  formatDiffTable,
  formatDwellTable,
  formatPassCountTable,
  formatPriceTable,
  formatRoundTripLine,
  formatSweepTable,
  formatTable,
} from './table-pure';

const row: PriceFrameRow = {
  pass: 'localDepth',
  method: 'timer-query',
  baselineMs: 41.4,
  disabledMs: 30.1,
  savedMs: 11.3,
  savedPct: 27.3,
  samples: 120,
  iqrMs: 2.1,
  noiseMs: 0.4,
  bracketMs: 0.9,
  baselineLag1: -0.12,
  disabledLag1: 0.03,
  baselineReadback: 0.25,
  disabledReadback: 0.25,
  baselineLimitMag: 1.511,
  disabledLimitMag: 1.511,
  bufferMpx: 4.096,
};

describe('formatPriceTable', () => {
  it('keeps the in-app console.table column order', () => {
    expect(PRICE_ROW_COLUMNS).toEqual([
      'pass', 'method', 'baselineMs', 'disabledMs', 'savedMs', 'savedPct', 'samples',
      'iqrMs', 'noiseMs', 'bracketMs', 'baselineLag1', 'disabledLag1',
      'baselineReadback', 'disabledReadback', 'baselineLimitMag', 'disabledLimitMag', 'bufferMpx',
    ]);
  });

  it('right-aligns every column to its widest cell and blanks a missing bracket', () => {
    const { bracketMs: _dropped, ...single } = row;
    const text = formatPriceTable([row, { ...single, pass: 'mwBand' }]);
    expect(text).toBe([
      '      pass       method  baselineMs  disabledMs  savedMs  savedPct  samples  iqrMs  noiseMs  bracketMs  baselineLag1  disabledLag1  baselineReadback  disabledReadback  baselineLimitMag  disabledLimitMag  bufferMpx',
      'localDepth  timer-query        41.4        30.1     11.3      27.3      120    2.1      0.4        0.9         -0.12          0.03              0.25              0.25             1.511             1.511      4.096',
      '    mwBand  timer-query        41.4        30.1     11.3      27.3      120    2.1      0.4                    -0.12          0.03              0.25              0.25             1.511             1.511      4.096',
    ].join('\n'));
  });

  it('prints the header alone for no rows', () => {
    expect(formatPriceTable([]).split('\n')).toHaveLength(1);
  });
});

describe('formatTable', () => {
  it('widens a column to its header when every cell is narrower', () => {
    expect(formatTable(['header', 'x'], [[1, 2]])).toBe('header  x\n     1  2');
  });
});

const dwell: DwellSummary = {
  samples: 240, p50: 30.125, p90: 33.5, p99: 41.75, iqrMs: 1.25, lag1: -0.31, vsyncClamped: false,
  quarterMedians: [30, 30.125, 30.125, 30.25], stateGuard: 'steady',
};

describe('formatDwellTable', () => {
  it('prints one row per clock, the rAF deltas first', () => {
    const lines = formatDwellTable([
      ['raf-delta', dwell],
      ['gpu-timestamp', { ...dwell, p50: 28.5 }],
    ]).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('vsyncClamped');
    expect(lines[1]).toContain('raf-delta');
    expect(lines[1]).toContain('30.125');
    expect(lines[2]).toContain('gpu-timestamp');
  });

  it('prints the clamp flag as a word rather than blanking a false', () => {
    expect(formatDwellTable([['raf-delta', dwell]])).toContain('false');
  });
});

describe('formatPassCountTable', () => {
  it('prints one row per counter in roster order', () => {
    const one = { min: 3, p50: 3, max: 5 };
    const lines = formatPassCountTable({
      submits: one, commandBuffers: one, renderPasses: { min: 4, p50: 4, max: 12 }, computePasses: { min: 0, p50: 0, max: 0 },
    }).split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain('perFrame');
    expect(lines[1]).toContain('submits');
    expect(lines[3]).toContain('renderPasses');
    expect(lines[3]).toContain('12');
  });
});

describe('formatRoundTripLine', () => {
  const record = (p50: number, gpu: number | null): DwellRecord => ({
    deltasMs: [p50], gpuMs: null, gpuNote: '', stats: { ...dwell, p50 },
    gpuStats: gpu === null ? null : { ...dwell, p50: gpu },
    limitMag: 7.8, dm: 0, readbackPerFrame: 0.25, passCounts: null,
  });

  it('reads the second dwell against the first as a ratio on each clock', () => {
    const line = formatRoundTripLine('localDepth', record(20, 17), record(25, 22.1));
    expect(line).toContain('round trip localDepth');
    expect(line).toContain('raf p50 20 → 25 (×1.250)');
    expect(line).toContain('gpu p50 17 → 22.1 (×1.300)');
    expect(line).toContain('limit 7.8 → 7.8 mag');
  });

  it('omits the GPU clock where either dwell lacks a stream', () => {
    expect(formatRoundTripLine('idle', record(20, null), record(20, 17))).not.toContain('gpu p50');
  });
});

describe('formatSweepTable', () => {
  const points: SweepPoint[] = [
    { scale: 1, width: 1280, height: 800, px: 4_096_000, ms: 40, vsyncClamped: false },
    { scale: 2, width: 2560, height: 1600, px: 16_384_000, ms: 160, vsyncClamped: false },
  ];

  it('appends the fit under the points', () => {
    const text = formatSweepTable(points, { slope: 1, r2: 1, bound: 'fill', fitted: 2 }, 0.75);
    expect(text.split('\n')).toHaveLength(4);
    expect(text).toContain('4.096');
    expect(text).toContain('slope 1.000 · r² 1.000 · bound fill · sweep bracket 0.750 ms');
  });
});

describe('formatDiffTable', () => {
  it('marks the three verdicts', () => {
    const diff: RunDiff = {
      refusedWholeRun: null,
      refusals: [],
      rows: [
        { key: 'sol|webgl2|a', metric: 'savedMs', baselineMs: 10, currentMs: 10, deltaMs: 0, bandMs: 2, verdict: 'same' },
        { key: 'sol|webgl2|b', metric: 'savedMs', baselineMs: 10, currentMs: 4, deltaMs: -6, bandMs: 2, verdict: 'cheaper' },
        { key: 'sol|webgl2|dwell', metric: 'p50', baselineMs: 30, currentMs: 38, deltaMs: 8, bandMs: 2, verdict: 'dearer' },
      ],
    };
    const lines = formatDiffTable(diff).split('\n');
    expect(lines[1]).toContain('~');
    expect(lines[2]).toContain('✓');
    expect(lines[3]).toContain('✗');
  });

  it('says only that the run was refused, with no rows to read past it', () => {
    const text = formatDiffTable({ refusedWholeRun: 'adapter A vs B', rows: [], refusals: [] });
    expect(text).toBe('baseline: REFUSED — adapter A vs B');
  });

  it('lists refusals under the table', () => {
    const text = formatDiffTable({
      refusedWholeRun: null,
      rows: [],
      refusals: [{ key: 'sol|webgl2', reason: 'method raf-delta vs timer-query' }],
    });
    expect(text).toContain('not compared: sol|webgl2 — method raf-delta vs timer-query');
  });

  it('says so when neither run had anything comparable', () => {
    expect(formatDiffTable({ refusedWholeRun: null, rows: [], refusals: [] }))
      .toBe('baseline: nothing comparable in either run');
  });
});
