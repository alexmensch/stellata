import { describe, expect, it } from 'vitest';
import type { PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { BUFFER_MPX_TOLERANCE, diffRuns, type RunDiff } from './diff-pure';
import type { DwellSummary } from './dwell-pure';
import { PERF_SCHEMA, type PerfFile, type ScenarioRecord } from './schema';

function priceRow(overrides: Partial<PriceFrameRow> & { pass: string }): PriceFrameRow {
  return {
    method: 'raf-delta',
    baselineMs: 40,
    disabledMs: 30,
    savedMs: 10,
    savedPct: 25,
    samples: 100,
    iqrMs: 2,
    noiseMs: 1,
    baselineLag1: 0,
    disabledLag1: 0,
    baselineReadback: 0.25,
    disabledReadback: 0.25,
    baselineLimitMag: 1.5,
    disabledLimitMag: 1.5,
    bufferMpx: 4.096,
    ...overrides,
  };
}

/** iqr 1.349 over 100 samples puts the median's standard error at exactly
 *  0.12533 ms, so a two-sigma band comes out at 0.354. */
function dwellStats(p50: number, overrides: Partial<DwellSummary> = {}): DwellSummary {
  return {
    samples: 100,
    p50,
    p90: p50 + 2,
    p99: p50 + 5,
    iqrMs: 1.349,
    lag1: 0,
    vsyncClamped: false,
    ...overrides,
  };
}

function scenario(overrides: Partial<ScenarioRecord> = {}): ScenarioRecord {
  return {
    name: 'sol',
    blob: 'blob',
    backend: { requested: 'webgl2', actual: 'webgl2' },
    viewport: { width: 1280, height: 800, dpr: 2 },
    buffer: { width: 2560, height: 1600 },
    bufferMpx: 4.096,
    mode: 'differential',
    method: 'raf-delta',
    params: {},
    settleMs: 5000,
    idleRafMs: 16.7,
    differential: null,
    dwell: null,
    dwellAfter: null,
    roundtrip: null,
    sweep: null,
    console: [],
    pageErrors: [],
    tainted: false,
    failed: false,
    failure: null,
    ...overrides,
  };
}

function file(scenarios: readonly ScenarioRecord[], adapter = 'Apple M3 Max'): PerfFile {
  return {
    schema: PERF_SCHEMA,
    run: {
      startedAt: '2026-09-04T10:00:00.000Z',
      finishedAt: '2026-09-04T10:05:00.000Z',
      url: 'http://localhost:5173',
      argv: [],
      git: { commit: 'abc1234', dirty: false },
      browser: { name: 'chromium', version: '1', channel: 'chromium', headless: true, args: [] },
      gpu: {
        webgl: { renderer: adapter, vendor: 'Apple', timerQuery: true },
        webgpu: null,
      },
      host: { platform: 'darwin', arch: 'arm64' },
    },
    scenarios,
  };
}

function withDifferential(rows: readonly PriceFrameRow[], overrides: Partial<ScenarioRecord> = {}): PerfFile {
  return file([scenario({ differential: rows, ...overrides })]);
}

function withDwell(stats: DwellSummary, overrides: Partial<ScenarioRecord> = {}): PerfFile {
  return file([scenario({
    mode: 'dwell',
    differential: null,
    dwell: {
      deltasMs: [],
      gpuMs: null,
      gpuNote: 'not requested',
      stats,
      gpuStats: null,
      limitMag: 1.5,
      dm: -6.29,
      readbackPerFrame: 0.25,
      passCounts: null,
    },
    ...overrides,
  })]);
}

function only(diff: RunDiff) {
  expect(diff.refusedWholeRun).toBeNull();
  expect(diff.rows).toHaveLength(1);
  return diff.rows[0];
}

describe('diffRuns — a run against itself', () => {
  it('calls every differential row unchanged', () => {
    const run = withDifferential([priceRow({ pass: 'localDepth' }), priceRow({ pass: 'reduction' })]);
    const diff = diffRuns(run, run);
    expect(diff.rows.map((r) => r.verdict)).toEqual(['same', 'same']);
    expect(diff.rows.every((r) => r.deltaMs === 0)).toBe(true);
  });

  it('calls a dwell unchanged', () => {
    const run = withDwell(dwellStats(30));
    expect(only(diffRuns(run, run)).verdict).toBe('same');
  });
});

describe('diffRuns — the noise band', () => {
  it('is two sigma of the pair, so equal noise floors of 1 ms give 2.83', () => {
    const row = only(diffRuns(
      withDifferential([priceRow({ pass: 'localDepth', savedMs: 10 })]),
      withDifferential([priceRow({ pass: 'localDepth', savedMs: 12 })]),
    ));
    expect(row.bandMs).toBeCloseTo(2.8284, 4);
    expect(row.deltaMs).toBe(2);
    expect(row.verdict).toBe('same');
  });

  it('calls a move past the band dearer', () => {
    const row = only(diffRuns(
      withDifferential([priceRow({ pass: 'localDepth', savedMs: 10 })]),
      withDifferential([priceRow({ pass: 'localDepth', savedMs: 14 })]),
    ));
    expect(row.deltaMs).toBe(4);
    expect(row.verdict).toBe('dearer');
  });

  it('lets the bracket floor override a small noise band', () => {
    const row = only(diffRuns(
      withDifferential([priceRow({ pass: 'localDepth', savedMs: 10, bracketMs: 9 })]),
      withDifferential([priceRow({ pass: 'localDepth', savedMs: 14, bracketMs: 9 })]),
    ));
    expect(row.bandMs).toBe(9);
    expect(row.verdict).toBe('same');
  });

  it('takes the larger of the two brackets', () => {
    const row = only(diffRuns(
      withDifferential([priceRow({ pass: 'localDepth', savedMs: 10, bracketMs: 1 })]),
      withDifferential([priceRow({ pass: 'localDepth', savedMs: 14, bracketMs: 9 })]),
    ));
    expect(row.bandMs).toBe(9);
  });

  it('bands a dwell on the median standard error, not the bracket', () => {
    const row = only(diffRuns(withDwell(dwellStats(30)), withDwell(dwellStats(30.2))));
    expect(row.metric).toBe('p50');
    expect(row.bandMs).toBeCloseTo(0.35449, 5);
    expect(row.verdict).toBe('same');
  });
});

describe('diffRuns — sign conventions', () => {
  it('reads a fallen dwell p50 as cheaper', () => {
    const row = only(diffRuns(withDwell(dwellStats(30)), withDwell(dwellStats(25))));
    expect(row.deltaMs).toBe(-5);
    expect(row.verdict).toBe('cheaper');
  });

  it('reads a RISEN savedMs as dearer — the field names the pass price, not a win', () => {
    const row = only(diffRuns(
      withDifferential([priceRow({ pass: 'reduction', savedMs: 10 })]),
      withDifferential([priceRow({ pass: 'reduction', savedMs: 20 })]),
    ));
    expect(row.metric).toBe('savedMs');
    expect(row.deltaMs).toBe(10);
    expect(row.verdict).toBe('dearer');
  });

  it('reads a fallen savedMs as cheaper, including across zero', () => {
    const row = only(diffRuns(
      withDifferential([priceRow({ pass: 'extinctionPrepass', savedMs: 4 })]),
      withDifferential([priceRow({ pass: 'extinctionPrepass', savedMs: -6 })]),
    ));
    expect(row.deltaMs).toBe(-10);
    expect(row.verdict).toBe('cheaper');
  });
});

describe('diffRuns — refusals', () => {
  // A foreign schema never reaches diffRuns: assertPerfFile refuses the file
  // before a diff is asked for (schema.test.ts pins that). Re-checking it here
  // would be a branch the runner cannot take.

  it('refuses the whole run across two adapters', () => {
    const diff = diffRuns(
      file([scenario({ differential: [priceRow({ pass: 'localDepth' })] })], 'Apple M3 Max'),
      file([scenario({ differential: [priceRow({ pass: 'localDepth' })] })], 'Apple M1'),
    );
    expect(diff.refusedWholeRun).toContain('Apple M1');
    expect(diff.rows).toEqual([]);
  });

  it('refuses a pair measured on two clocks', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'localDepth' })]),
      withDifferential([priceRow({ pass: 'localDepth', method: 'timer-query' })], { method: 'timer-query' }),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('never comparable');
  });

  it('refuses a pair whose buffers differ by more than the tolerance', () => {
    const wider = 4.096 * (1 + BUFFER_MPX_TOLERANCE * 2);
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'localDepth' })]),
      withDifferential([priceRow({ pass: 'localDepth' })], { bufferMpx: wider }),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('fill-bound');
  });

  it('allows a buffer inside the tolerance', () => {
    const nudged = 4.096 * (1 + BUFFER_MPX_TOLERANCE / 2);
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'localDepth' })]),
      withDifferential([priceRow({ pass: 'localDepth' })], { bufferMpx: nudged }),
    );
    expect(diff.rows).toHaveLength(1);
  });

  it('refuses a scenario either run failed or tainted', () => {
    for (const flag of [{ failed: true }, { tainted: true }] as const) {
      const diff = diffRuns(
        withDifferential([priceRow({ pass: 'localDepth' })]),
        withDifferential([priceRow({ pass: 'localDepth' })], flag),
      );
      expect(diff.rows).toEqual([]);
      expect(diff.refusals[0].reason).toContain('failed or was tainted');
    }
  });

  it('refuses a dwell that measured the panel', () => {
    const diff = diffRuns(
      withDwell(dwellStats(30)),
      withDwell(dwellStats(16.6, { vsyncClamped: true })),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('measured the panel');
  });

  it('names a scenario the current run did not measure', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'localDepth' })]),
      file([scenario({ name: 'mw120', differential: [priceRow({ pass: 'localDepth' })] })]),
    );
    expect(diff.refusals.map((r) => r.key)).toContain('sol|webgl2');
  });

  it('names a pass the current run did not price', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'localDepth' }), priceRow({ pass: 'reduction' })]),
      withDifferential([priceRow({ pass: 'localDepth' })]),
    );
    expect(diff.rows).toHaveLength(1);
    expect(diff.refusals[0].key).toBe('sol|webgl2|reduction');
  });

  it('says a vantage measured on the other backend was not absent', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'localDepth' })]),
      file([scenario({
        backend: { requested: 'webgpu', actual: 'webgpu' },
        differential: [priceRow({ pass: 'localDepth' })],
      })]),
    );
    expect(diff.refusals[0].key).toBe('sol|webgl2');
    expect(diff.refusals[0].reason).toContain('measured on webgpu in the current run');
    expect(diff.refusals[0].reason).not.toContain('absent');
  });

  it('keys the two backends of one scenario apart', () => {
    const both = (adapterRows: readonly PriceFrameRow[]): PerfFile => file([
      scenario({ differential: adapterRows }),
      scenario({ backend: { requested: 'webgpu', actual: 'webgpu' }, differential: adapterRows }),
    ]);
    const diff = diffRuns(both([priceRow({ pass: 'localDepth' })]), both([priceRow({ pass: 'localDepth' })]));
    expect(diff.rows.map((r) => r.key)).toEqual(['sol|webgl2|localDepth', 'sol|webgpu|localDepth']);
  });

  it('does not pretend a sweep is a cost', () => {
    const swept = file([scenario({
      mode: 'sweep',
      sweep: { points: [], fit: { slope: 1, r2: 1, bound: 'fill', fitted: 0 }, bracketMs: 0 },
    })]);
    const diff = diffRuns(swept, swept);
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].key).toBe('sol|webgl2|sweep');
  });
});
