import { describe, expect, it } from 'vitest';
import type { PriceFrameRow } from '../../../src/client/debug/frame-cost/frame-cost-pure';
import { EMPTY_PASS_KEY } from '../../../src/client/debug/frame-cost/passes/passes-pure';
import {
  BUFFER_MPX_TOLERANCE, COMPUTE_SCATTER_FLOOR_MS, DWELL_FLOOR_FRACTION, DWELL_FLOOR_MS,
  READBACK_TOLERANCE, RECORD_COUNT_TOLERANCE, computeFloorMs, diffRuns, dwellFloorMs, framesRefusal,
  positionRefusal, preconditionRefusal, splitFrameClasses, type RunDiff,
} from './diff-pure';
import type { DwellSummary } from '../dwell/dwell-pure';
import { PERF_SCHEMA, type DwellRecord, type PerfFile, type ScenarioRecord } from '../schema';
import type { ScenarioName } from '../scenarios';

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

const RECORDS = 388063;

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
    quarterMedians: [p50, p50, p50, p50],
    stateGuard: 'steady',
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
    recordCount: RECORDS,
    position: 1,
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
      git: { commit: 'abc1234', dirty: false, mainCommit: 'abc1234', mainReachable: true },
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

function withDwell(
  stats: DwellSummary,
  overrides: Partial<ScenarioRecord> = {},
  gpuStats: DwellSummary | null = null,
): PerfFile {
  return file([scenario({
    mode: 'dwell',
    differential: null,
    dwell: {
      deltasMs: [],
      gpuMs: gpuStats === null ? null : [],
      gpuNote: gpuStats === null ? 'not requested' : 'sound',
      stats,
      gpuStats,
      limitMag: 1.5,
      dm: -6.29,
      readbackPerFrame: 0.25,
      passCounts: null,
    },
    ...overrides,
  })]);
}

function withCompute(
  frame: number,
  compute: number | null,
  { computeMs = [], name = 'sol', stats = {} }: {
    computeMs?: readonly number[];
    name?: ScenarioName;
    stats?: Partial<DwellSummary>;
  } = {},
): PerfFile {
  return withDwell(dwellStats(16.7), {
    name,
    dwell: {
      deltasMs: [],
      gpuMs: [],
      gpuNote: 'sound',
      stats: dwellStats(16.7),
      gpuStats: dwellStats(frame, stats),
      computeMs: compute === null ? null : computeMs,
      computeStats: compute === null ? null : dwellStats(compute, stats),
      limitMag: 1.5,
      dm: -6.29,
      readbackPerFrame: 0.25,
      passCounts: null,
    },
  }, dwellStats(frame, stats));
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
    expect(row.metric).toBe('wall-p50');
    expect(row.bandMs).toBeCloseTo(0.35449, 5);
    expect(row.verdict).toBe('same');
  });
});

describe('the whole-frame floor — one number, both gates', () => {
  it('is 0.25 ms or 1 % of the baseline, whichever is larger', () => {
    expect(DWELL_FLOOR_MS).toBe(0.25);
    expect(DWELL_FLOOR_FRACTION).toBe(0.01);
    expect(dwellFloorMs(10)).toBe(0.25);
    expect(dwellFloorMs(40)).toBe(0.4);
  });

  it('binds on the millisecond term at every canon row but mw50, where 1 % is larger', () => {
    expect(dwellFloorMs(21.8)).toBe(DWELL_FLOOR_MS);
    expect(dwellFloorMs(16.9)).toBe(DWELL_FLOOR_MS);
    expect(dwellFloorMs(31.451)).toBe(0.31451);
  });

  // The measured case. 240 frames at a tight iqr put two sigma of the pair's
  // scatter at ~0.02 ms, so an unfloored band marks a 0.15 ms move — and a
  // move that size is what changing a context's POSITION in its run produces
  // on unchanged code: mw120 read 21.950 against 21.464 between two runs,
  // 7th of 10 behind cool-downs against 1st of 2 cold. The floor is the
  // pin's, so the tier that feeds the pin cannot gate tighter than it does.
  it('floors a dwell band that sampling alone would draw far tighter', () => {
    const steady = { iqrMs: 0.135, samples: 240 };
    const row = only(diffRuns(
      withDwell(dwellStats(16.7), {}, dwellStats(21.95, steady)),
      withDwell(dwellStats(16.7), {}, dwellStats(22.10, steady)),
    ));
    expect(row.metric).toBe('gpu-p50');
    expect(row.bandMs).toBe(dwellFloorMs(21.95));
    expect(row.bandMs).toBe(0.25);
    expect(row.verdict).toBe('same');
  });

  it('still marks a move past the floor', () => {
    const steady = { iqrMs: 0.135, samples: 240 };
    const row = only(diffRuns(
      withDwell(dwellStats(16.7), {}, dwellStats(21.95, steady)),
      withDwell(dwellStats(16.7), {}, dwellStats(22.35, steady)),
    ));
    expect(row.verdict).toBe('dearer');
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

  it('refuses a differential row whose median the display cadence set', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'emptyPass', savedMs: -0.025, cadenceBound: true })]),
      withDifferential([priceRow({ pass: 'emptyPass', savedMs: -0.4, cadenceBound: true })]),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('display cadence');
  });

  it('refuses when only ONE side is cadence-bound — a pre-flag baseline still compares', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'emptyPass', savedMs: -0.025 })]),
      withDifferential([priceRow({ pass: 'emptyPass', savedMs: -0.4, cadenceBound: true })]),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('display cadence');
  });

  it('refuses a dwell that measured the panel', () => {
    const diff = diffRuns(
      withDwell(dwellStats(30)),
      withDwell(dwellStats(16.6, { vsyncClamped: true })),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('measured the panel');
  });

  it('refuses a dwell that trended across its quarters', () => {
    const diff = diffRuns(
      withDwell(dwellStats(30)),
      withDwell(dwellStats(30, { quarterMedians: [28, 29, 30, 31.5], stateGuard: 'trending' })),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('load-state transition');
  });

  // Where the GPU stream is sound the wall clock is neither marked nor read,
  // so its alternation between one and two refresh intervals is no longer a
  // refusal — the case that made a vantage over one interval uncomparable
  // and cost Tier 1 its two witnesses.
  it('compares a vantage whose wall clock alternated, on the GPU stream that did not', () => {
    const alternating = dwellStats(16.7, { quarterMedians: [16.7, 33.4, 16.7, 33.4], stateGuard: 'trending' });
    const row = only(diffRuns(
      withDwell(alternating, {}, dwellStats(31.84)),
      withDwell(dwellStats(33.4, { quarterMedians: [33.4, 16.7, 33.4, 16.7], stateGuard: 'trending' }), {}, dwellStats(31.85)),
    ));
    expect(row.metric).toBe('gpu-p50');
    expect([row.baselineMs, row.currentMs]).toEqual([31.84, 31.85]);
    expect(row.verdict).toBe('same');
  });

  // Same rule one test over: the clamp is a statement about the wall clock,
  // and a resolved timestamp is a span the hardware reports that no
  // compositor can pad. mw120|webgpu is the vantage this frees.
  it('compares a wall-clamped dwell whose GPU stream is sound', () => {
    const row = only(diffRuns(
      withDwell(dwellStats(16.7, { vsyncClamped: true }), {}, dwellStats(11.2)),
      withDwell(dwellStats(16.7, { vsyncClamped: true }), {}, dwellStats(13.9)),
    ));
    expect(row.metric).toBe('gpu-p50');
    expect(row.deltaMs).toBeCloseTo(2.7, 5);
    expect(row.verdict).toBe('dearer');
  });

  it('refuses a GPU stream on one side against a wall median on the other', () => {
    const diff = diffRuns(
      withDwell(dwellStats(30), {}, dwellStats(21.8)),
      withDwell(dwellStats(30)),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('two instruments');
  });

  it('refuses a GPU stream that trended under a wall clock that read steady', () => {
    const diff = diffRuns(
      withDwell(dwellStats(30), {}, dwellStats(21.8)),
      withDwell(dwellStats(30), {}, dwellStats(21.8, { quarterMedians: [20.3, 21.3, 22.3, 23.3], stateGuard: 'trending' })),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('load-state transition');
  });

  it('refuses a comparison across two record sets', () => {
    const diff = diffRuns(
      withDwell(dwellStats(30)),
      withDwell(dwellStats(30), { recordCount: RECORDS + 54458 }),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain(`${RECORDS} vs ${RECORDS + 54458} records`);
    expect(diff.refusals[0].reason).toContain('14.0 % apart');
  });

  // A membership change under the tolerance owes no `## Perf` section, so it
  // ships without re-taking the pin — and would deadlock every later
  // comparison if the refusal here were exact. The two bounds are one bound.
  it('compares across a record set inside the tolerance, and refuses just past it', () => {
    const inside = Math.floor(RECORDS * (1 + RECORD_COUNT_TOLERANCE));
    const outside = Math.ceil(RECORDS * (1 + RECORD_COUNT_TOLERANCE)) + 1;
    expect(diffRuns(withDwell(dwellStats(30)), withDwell(dwellStats(30), { recordCount: inside })).rows)
      .toHaveLength(1);
    expect(diffRuns(withDwell(dwellStats(30)), withDwell(dwellStats(30), { recordCount: outside })).rows)
      .toEqual([]);
  });

  it('reads the tolerance in both directions, so a shrunken catalogue is judged the same', () => {
    const shrunk = Math.ceil(RECORDS * (1 - RECORD_COUNT_TOLERANCE)) - 1;
    const diff = diffRuns(withDwell(dwellStats(30)), withDwell(dwellStats(30), { recordCount: shrunk }));
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('% apart');
  });

  // The measured case: mw120|webgpu read 21.950 ms as 8th of 10 behind
  // cool-downs and 21.464 as 1st of 2 cold, on identical render code, while
  // two runs of the same shape agreed to 0.019. Position is the variable.
  it('refuses a row taken at another position in its run', () => {
    const diff = diffRuns(
      withDwell(dwellStats(16.7), { position: 8 }, dwellStats(21.95)),
      withDwell(dwellStats(16.7), { position: 1 }, dwellStats(21.464)),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('run position 8 vs 1');
    expect(positionRefusal(2, 2)).toBeNull();
  });

  it('refuses a row whose run did not record its position, on either side', () => {
    const placed = withDwell(dwellStats(30));
    const unplaced = withDwell(dwellStats(30), { position: null });
    for (const [a, b] of [[placed, unplaced], [unplaced, placed]]) {
      expect(diffRuns(a, b).refusals[0].reason).toContain('cannot be placed in a load history');
    }
    expect(positionRefusal(undefined, 1)).toContain('unknown vs 1');
  });

  // The failure this exists for: a pin re-taken at the runner's default 240
  // replaces one taken at 960, both dwells read steady, the band widens with
  // neither, and every later verdict against it means nothing.
  it('refuses two dwells taken over different frame counts', () => {
    const diff = diffRuns(
      withDwell(dwellStats(16.7), { params: { frames: 960 } }, dwellStats(19.0)),
      withDwell(dwellStats(16.7), { params: { frames: 240 } }, dwellStats(18.9)),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('dwell 960 vs 240 frames');
    expect(framesRefusal(960, 960)).toBeNull();
  });

  // Unlike the record count, an absent frame count DECLINES rather than
  // refuses: a pin written before the field existed has to stay usable.
  it('declines the frame-count guard where either side did not record one', () => {
    expect(framesRefusal(undefined, 960)).toBeNull();
    expect(framesRefusal(960, undefined)).toBeNull();
    expect(framesRefusal(undefined, undefined)).toBeNull();
    const counted = withDwell(dwellStats(30), { params: { frames: 960 } });
    const uncounted = withDwell(dwellStats(30), { params: {} });
    expect(diffRuns(counted, uncounted).refusals).toEqual([]);
  });

  it('refuses a comparison where either side recorded no record count', () => {
    const counted = withDwell(dwellStats(30));
    const uncounted = withDwell(dwellStats(30), { recordCount: null });
    for (const [a, b] of [[counted, uncounted], [uncounted, counted], [uncounted, uncounted]]) {
      const diff = diffRuns(a, b);
      expect(diff.rows).toEqual([]);
      expect(diff.refusals[0].reason).toContain('cannot be placed on a scene');
    }
  });

  it('refuses a sweep that held passes off against one that did not', () => {
    const plain = withDifferential([priceRow({ pass: 'statisticWrites' })]);
    const held = withDifferential([priceRow({ pass: 'statisticWrites' })], {
      params: { preDisable: ['mwBand', 'lgEmission'] },
    });
    const diff = diffRuns(plain, held);
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('passes held off none vs lgEmission,mwBand');
  });

  it('compares two sweeps that held the SAME passes off, whatever the order given', () => {
    const one = withDifferential([priceRow({ pass: 'statisticWrites' })], {
      params: { preDisable: ['mwBand', 'lgEmission'] },
    });
    const other = withDifferential([priceRow({ pass: 'statisticWrites', savedMs: 10 })], {
      params: { preDisable: ['lgEmission', 'mwBand'] },
    });
    expect(only(diffRuns(one, other)).verdict).toBe('same');
  });

  it('refuses an unparked sweep against a parked one', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'statisticWrites' })]),
      withDifferential([priceRow({ pass: 'statisticWrites' })], { params: { noPark: true } }),
    );
    expect(diff.refusals[0].reason).toContain('adaptation park live vs off');
  });

  it('refuses a forced-recompute sweep against a camera-gated one', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'extinctionPrepass' })]),
      withDifferential([priceRow({ pass: 'extinctionPrepass' })], {
        params: { forceRecompute: true },
      }),
    );
    expect(diff.refusals[0].reason).toContain('extinction recompute gated vs forced');
  });

  it('refuses a bracketed sweep against a single-baseline one', () => {
    const diff = diffRuns(
      withDifferential([priceRow({ pass: 'localDepth' })]),
      withDifferential([priceRow({ pass: 'localDepth' })], { params: { interleave: false } }),
    );
    expect(diff.refusals[0].reason).toContain('two estimators');
  });

  it('reads an absent precondition as the flag default, so a pre-flag run still compares', () => {
    expect(preconditionRefusal(
      {},
      { preDisable: [], noPark: false, forceRecompute: false, interleave: true },
    )).toBeNull();
  });

  it('refuses the emptyPass row across two counts, and keeps every other row', () => {
    const rows = [priceRow({ pass: 'localDepth' }), priceRow({ pass: EMPTY_PASS_KEY })];
    const diff = diffRuns(
      withDifferential(rows, { params: { emptyPasses: 1 } }),
      withDifferential(rows, { params: { emptyPasses: 4 } }),
    );
    expect(diff.rows.map((r) => r.key)).toEqual(['sol|webgl2|localDepth']);
    expect(diff.refusals[0].reason).toContain('1 vs 4 empty passes added');
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

describe('the compute row', () => {
  it('bands the compute stream beside the frame, keyed |compute', () => {
    const diff = diffRuns(
      withCompute(18.98, 1.4, { computeMs: [1.2, 1.4] }),
      withCompute(18.98, 2.0, { computeMs: [1.8, 2.0] }),
    );
    expect(diff.refusals).toEqual([]);
    expect(diff.rows.map((r) => [r.key, r.metric, r.verdict])).toEqual([
      ['sol|webgl2|dwell', 'gpu-p50', 'same'],
      ['sol|webgl2|compute', 'compute-p50', 'dearer'],
    ]);
    // 100 samples at iqr 1.349: two sigma of the pair is 0.354, over the
    // 0.25 ms floor, so this fixture's band is its own sampling error.
    expect(diff.rows[1].bandMs).toBeCloseTo(0.354, 3);
    expect(diff.rows[1].bandMs).toBeGreaterThan(computeFloorMs('sol', 1.4));
    expect(diff.rows[1].floorDeltaMs).toBeCloseTo(0.6, 9);
  });

  it("bands it on the vantage's own floor, not the whole-frame constant", () => {
    expect(COMPUTE_SCATTER_FLOOR_MS).toEqual({
      mw120: 0.05, sol: 0.45, earth: 0.15, mw50: 0.05, lg: 0.50,
    });
    expect(computeFloorMs('mw120', 0.289)).toBe(0.05);
    expect(computeFloorMs('mw50', 0.308)).toBe(0.05);
    expect(computeFloorMs('earth', 0.418)).toBe(0.15);
  });

  // Every constant is 1.5x its vantage's population span rounded up to 0.05,
  // and a table that does not re-derive is one a later session re-litigates.
  it('holds each constant at the derivation the README states', () => {
    const POPULATION_SPAN_MS = {
      mw120: 0.032, sol: 0.284, earth: 0.094, mw50: 0.017, lg: 0.303,
    } as const;
    for (const [name, span] of Object.entries(POPULATION_SPAN_MS)) {
      const derived = Number((Math.ceil((1.5 * span) / 0.05) * 0.05).toFixed(2));
      expect([name, COMPUTE_SCATTER_FLOOR_MS[name as ScenarioName]]).toEqual([name, derived]);
    }
  });

  // sol's and lg's measured scatter is 0.284 and 0.303 ms, past the inherited
  // constant — following it would WIDEN the only row that can see a compute
  // regression at all.
  it('caps every vantage at the whole-frame floor, so a re-floor only tightens', () => {
    expect(computeFloorMs('sol', 0.446)).toBe(DWELL_FLOOR_MS);
    expect(computeFloorMs('lg', 0.589)).toBe(DWELL_FLOOR_MS);
  });

  it('keeps the 1 % term, which binds on a compute row that has run away', () => {
    expect(computeFloorMs('mw120', 13.17)).toBeCloseTo(0.1317, 9);
  });

  // The measured case, both sides from `.perf-runs/2026-09-15/8cg-74-compute-
  // scatter.json`: mw120's repeat scatter is 0.009 ms and its pinned compute
  // 0.289, so a move of 0.06 is six times the noise and a fifth of the pass.
  // Under the inherited 0.25 the compaction could have gone most of the way
  // to twice as dear and read `~`.
  it('marks a mw120 compute move the inherited constant could not see', () => {
    const tight = { samples: 960, iqrMs: 0.02 };
    const diff = diffRuns(
      withCompute(19.227, 0.289, { name: 'mw120', stats: tight }),
      withCompute(19.227, 0.350, { name: 'mw120', stats: tight }),
    );
    expect(diff.refusals).toEqual([]);
    const compute = diff.rows[1];
    expect(compute.key).toBe('mw120|webgl2|compute');
    expect(compute.bandMs).toBe(0.05);
    expect(compute.verdict).toBe('dearer');
    expect(Math.abs(compute.deltaMs)).toBeLessThan(DWELL_FLOOR_MS);
  });

  // The re-floor reaches the compute row alone: the frame rows' own repeat
  // scatter runs PAST 0.25 at three of five vantages, so a floor sized for it
  // would end the gate rather than tighten it (`../pins/README.md` § The
  // compute row).
  it('leaves the frame row at the same vantage on the whole-frame floor', () => {
    const tight = { samples: 960, iqrMs: 0.02 };
    const diff = diffRuns(
      withCompute(19.227, 0.289, { name: 'mw120', stats: tight }),
      withCompute(19.350, 0.289, { name: 'mw120', stats: tight }),
    );
    const frame = diff.rows[0];
    expect(frame.key).toBe('mw120|webgl2|dwell');
    expect(frame.bandMs).toBe(DWELL_FLOOR_MS);
    expect(frame.verdict).toBe('same');
  });

  it('refuses the compute row where one run recorded the stream and the other did not, and keeps the frame row', () => {
    const diff = diffRuns(withCompute(18.98, null), withCompute(18.98, 1.4));
    expect(diff.rows.map((r) => r.key)).toEqual(['sol|webgl2|dwell']);
    expect(diff.refusals).toEqual([{
      key: 'sol|webgl2|compute',
      reason: 'one run recorded a compute stream for this row and the other did not',
    }]);
  });

  it('prints no compute row where neither run has one — a pre-compute archive, or WebGL2', () => {
    const diff = diffRuns(withCompute(18.98, null), withCompute(18.98, null));
    expect(diff.rows.map((r) => r.key)).toEqual(['sol|webgl2|dwell']);
    expect(diff.refusals).toEqual([]);
    const old = only(diffRuns(withDwell(dwellStats(30)), withDwell(dwellStats(30))));
    expect(old.key).toBe('sol|webgl2|dwell');
  });

  it('does not outlive a refused frame row', () => {
    const trended = { ...dwellStats(18.98), quarterMedians: [17, 17, 20, 20], stateGuard: 'trending' as const };
    const a = withCompute(18.98, 1.4);
    const b = withDwell(dwellStats(16.7), {
      dwell: { ...a.scenarios[0].dwell!, gpuStats: trended },
    }, trended);
    const diff = diffRuns(a, b);
    expect(diff.rows).toEqual([]);
    expect(diff.refusals.map((r) => r.key)).toEqual(['sol|webgl2|dwell']);
  });
});

describe('the exposure readback duty cycle', () => {
  const counts = (min: number, p50: number, max: number): DwellRecord['passCounts'] => ({
    perFrame: { submits: [], commandBuffers: [], renderPasses: [], computePasses: [] },
    summary: {
      submits: { min, p50, max },
      commandBuffers: { min, p50, max },
      renderPasses: { min, p50, max },
      computePasses: { min: 0, p50: 0, max: 0 },
    },
    note: 'counted',
  });

  const SPLIT = counts(4, 4, 10);
  const FLAT = counts(4, 4, 4);

  function dwellAt(
    gpuP50: number, readbackPerFrame: number, passCounts: DwellRecord['passCounts'],
  ): PerfFile {
    return withDwell(dwellStats(16.7), {
      dwell: {
        deltasMs: [],
        gpuMs: [],
        gpuNote: 'sound',
        stats: dwellStats(16.7),
        gpuStats: dwellStats(gpuP50),
        limitMag: 1.5,
        dm: -11.852,
        readbackPerFrame,
        passCounts,
      },
    }, dwellStats(gpuP50));
  }

  it('pins the bound at a quarter, clear of the 7 % spread a two-class vantage holds cold', () => {
    expect(READBACK_TOLERANCE).toBe(0.25);
  });

  // The archived pair this guard exists for: 17.157 ms at 0.25 readbacks per
  // frame against 52.854 at 0.579, on a frame whose wall p50 never left 16.70
  // and whose render-pass extremes never moved off 4/10.
  it('refuses a two-class frame whose duty cycle moved', () => {
    const diff = diffRuns(dwellAt(17.157, 0.25, SPLIT), dwellAt(52.854, 0.5792, SPLIT));
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('samples only the readback frames');
    expect(diff.refusals[0].reason).toContain('0.250 vs 0.579');
  });

  // The row this guard must NOT take. The duty cycle at the default view moved
  // as far as the two-class vantage's over the runs that measured its 9.33 ms
  // saving, and its frame has one class, so the median is the frame's.
  it('compares a one-class frame whose duty cycle moved just as far', () => {
    const row = only(diffRuns(dwellAt(22.406, 0.25, FLAT), dwellAt(13.076, 0.5917, FLAT)));
    expect(row.metric).toBe('gpu-p50');
    expect(row.deltaMs).toBeCloseTo(-9.33, 5);
    expect(row.verdict).toBe('cheaper');
  });

  it('admits the spread a two-class vantage holds across cold runs', () => {
    const row = only(diffRuns(dwellAt(17.157, 0.2375, SPLIT), dwellAt(17.46, 0.2542, SPLIT)));
    expect(row.verdict).toBe('same');
  });

  it('declines rather than refuses where the frame was never counted', () => {
    const row = only(diffRuns(dwellAt(17.157, 0.25, null), dwellAt(52.854, 0.5792, null)));
    expect(row.verdict).toBe('dearer');
  });

  // A run written before the counters existed carries no `passCounts` key at
  // all rather than a null, and 31 of the 257 archived dwells are such runs —
  // 16 with a resolved stream, so `--baseline` against one reaches the guard.
  // Reading the field off it must not throw the whole table away.
  it('declines where a run predates the counters and recorded no field at all', () => {
    const absent = undefined as unknown as DwellRecord['passCounts'];
    expect(splitFrameClasses(absent)).toBe(false);
    const row = only(diffRuns(dwellAt(17.157, 0.25, absent), dwellAt(52.854, 0.5792, absent)));
    expect(row.verdict).toBe('dearer');
  });

  // Wall is immune: every archived dwell at the two-class vantage reads 16.70
  // whatever the duty cycle does, so refusing there would spend the guard
  // where the artefact cannot reach.
  it('leaves a row judged on wall alone', () => {
    const wallOnly = (readbackPerFrame: number): PerfFile => withDwell(dwellStats(16.7), {
      dwell: {
        deltasMs: [],
        gpuMs: null,
        gpuNote: 'not requested',
        stats: dwellStats(16.7),
        gpuStats: null,
        limitMag: 1.5,
        dm: -11.852,
        readbackPerFrame,
        passCounts: SPLIT,
      },
    });
    const row = only(diffRuns(wallOnly(0.25), wallOnly(0.5792)));
    expect(row.metric).toBe('wall-p50');
    expect(row.verdict).toBe('same');
  });

  it('reads one class where the counters agree and two where they do not', () => {
    expect(splitFrameClasses(null)).toBe(false);
    expect(splitFrameClasses(FLAT)).toBe(false);
    expect(splitFrameClasses(SPLIT)).toBe(true);
  });
});
