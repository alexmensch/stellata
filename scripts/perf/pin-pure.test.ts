import { describe, expect, it } from 'vitest';
import { BUFFER_MPX_TOLERANCE, RECORD_COUNT_TOLERANCE, dwellFloorMs } from './diff-pure';
import type { DwellSummary } from './dwell/dwell-pure';
import {
  CANON_POSITIONS,
  PIN_CEILING_MS,
  PIN_SCHEMA,
  PIN_UNGATED_SCENARIOS,
  PinError,
  adapterSlug,
  assertPinFile,
  citeRunPath,
  commitStateFromExitStatus,
  compareToPin,
  missingCanonRows,
  pinDiffFails,
  pinFromRuns,
  pinPathFor,
  pinWriteRefusal,
  parseRenderPathDrift,
  pinProvenanceLines,
  unacceptedMarks,
  type PinFile,
} from './pin-pure';
import { PERF_SCHEMA, type AdapterProbe, type DwellRecord, type PerfFile, type ScenarioRecord } from './schema';
import { BACKENDS, SCENARIO_NAMES, TIER1_SCENARIOS, type Backend, type ScenarioName } from './scenarios';

const M4: AdapterProbe = {
  webgl: {
    renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)',
    vendor: 'Google Inc. (Apple)',
    timerQuery: true,
  },
  webgpu: {
    vendor: 'apple', architecture: 'metal-3', device: '', description: '',
    isFallbackAdapter: false, timestampsAvailable: true,
  },
};

const RECORDS = 388063;

/** iqr 1.349 over 240 samples: the median's standard error is 0.0809 ms, so
 *  a two-sigma band on a pair is 0.229 — always under the pin floor. */
function stats(p50: number, overrides: Partial<DwellSummary> = {}): DwellSummary {
  return {
    samples: 240, p50, p90: p50 + 2, p99: p50 + 5, iqrMs: 1.349, lag1: 0,
    vsyncClamped: false, quarterMedians: [p50, p50, p50, p50], stateGuard: 'steady',
    ...overrides,
  };
}

/** A clock that genuinely changed state under the dwell: quarter medians
 *  spanning 3 ms, well past `STATE_GUARD_TREND_MS`. */
function trending(p50: number): DwellSummary {
  return stats(p50, {
    quarterMedians: [p50 - 1.5, p50 - 0.5, p50 + 0.5, p50 + 1.5],
    stateGuard: 'trending',
  });
}

/** The wall clock at a vantage whose frame exceeds one refresh interval: the
 *  deltas alternate one/two intervals, so the quarter medians swing by a
 *  whole interval and the verdict is a coin flip. mw50 measured exactly this
 *  on two cold runs whose GPU quarters spanned 0.017 ms. */
function alternatingWall(): DwellSummary {
  return stats(33.4, { quarterMedians: [16.7, 33.4, 16.7, 33.4], stateGuard: 'trending' });
}

function dwell(wall: DwellSummary, gpu: DwellSummary | null): DwellRecord {
  return {
    deltasMs: [], gpuMs: gpu === null ? null : [], gpuNote: gpu === null ? 'webgl2 boot' : 'sound',
    stats: wall, gpuStats: gpu, limitMag: 1.511, dm: -6.289, readbackPerFrame: 0.25, passCounts: null,
  };
}

function scenario(
  name: ScenarioName, backend: Backend, record: DwellRecord, overrides: Partial<ScenarioRecord> = {},
): ScenarioRecord {
  return {
    name, blob: 'blob',
    backend: { requested: backend, actual: backend },
    viewport: { width: 1280, height: 800, dpr: 2 },
    buffer: { width: 2560, height: 1600 }, bufferMpx: 4.096, recordCount: RECORDS,
    position: CANON_POSITIONS.get(`${name}|${backend}`)!,
    mode: 'dwell', method: 'raf-delta', params: {}, settleMs: 5000, idleRafMs: 16.7,
    differential: null, dwell: record, dwellAfter: null, roundtrip: null, sweep: null,
    console: [], pageErrors: [], tainted: false, failed: false, failure: null,
    ...overrides,
  };
}

interface FileOverrides {
  gpu?: AdapterProbe | null;
  headless?: boolean;
  commit?: string;
  dirty?: boolean;
  finishedAt?: string;
}

function file(scenarios: readonly ScenarioRecord[], overrides: FileOverrides = {}): PerfFile {
  const commit = overrides.commit ?? 'abc1234';
  return {
    schema: PERF_SCHEMA,
    run: {
      startedAt: '2026-09-05T20:00:00.000Z', finishedAt: overrides.finishedAt ?? '2026-09-05T20:03:00.000Z',
      url: 'http://localhost:5173', argv: [],
      git: { commit, dirty: overrides.dirty ?? false, mainCommit: commit, mainReachable: true },
      browser: { name: 'chromium', version: '151', channel: 'chromium', headless: overrides.headless ?? true, args: [] },
      gpu: overrides.gpu === undefined ? M4 : overrides.gpu,
      host: { platform: 'darwin', arch: 'arm64' },
    },
    scenarios,
  };
}

const SOL_GPU = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)));
const MW120_GPU = scenario('mw120', 'webgpu', dwell(stats(16.7, { iqrMs: 0.4, vsyncClamped: true }), stats(21.0)));
const SOL_GL = scenario('sol', 'webgl2', dwell(stats(16.0, { iqrMs: 21 }), null));

/** The pinned lg row and a later one, at the wall clock lg actually reads:
 *  quantised to the refresh interval whatever the GPU stream does. */
const lgAt = (gpuP50: number) => scenario('lg', 'webgpu', dwell(stats(16.7), stats(gpuP50)));
const LG_GPU = lgAt(11.891);
const LG_TRENDED = scenario('lg', 'webgpu', dwell(stats(16.7), trending(12.5)));
const RUN = '.perf-runs/2026-09-05/pin.json';
const SOURCE = { version: '3.44.3', accepted: {} };

const runOf = (perf: PerfFile, sourceRun = RUN) => ({ file: perf, sourceRun });

function pinOf(scenarios: readonly ScenarioRecord[] = [SOL_GPU, MW120_GPU, SOL_GL]): PinFile {
  const { pin, refusals } = pinFromRuns([runOf(file(scenarios))], SOURCE);
  expect(refusals).toEqual([]);
  return pin!;
}

/** Every canon row, steady, so a pin is complete. */
function wholeCanon(gpuP50 = 20): ScenarioRecord[] {
  return BACKENDS.flatMap((backend) => SCENARIO_NAMES.map((name) =>
    scenario(name, backend, dwell(stats(16.7), backend === 'webgpu' ? stats(gpuP50) : null))));
}

describe('adapterSlug', () => {
  it('names the chip and the WebGPU architecture', () => {
    expect(adapterSlug(M4)).toBe('apple-m4-metal-3');
  });

  it('falls back to the renderer string outside the ANGLE Metal wrapper, and to the vendor without WebGL', () => {
    expect(adapterSlug({ webgl: { renderer: 'NVIDIA GeForce RTX 4080/PCIe/SSE2', vendor: 'NVIDIA', timerQuery: true }, webgpu: null }))
      .toBe('nvidia-geforce-rtx-4080-pcie-sse2');
    expect(adapterSlug({ webgl: null, webgpu: M4.webgpu })).toBe('apple-metal-3');
    expect(adapterSlug({ webgl: M4.webgl, webgpu: null })).toBe('apple-m4');
  });

  it('is null without a probe', () => {
    expect(adapterSlug(null)).toBeNull();
    expect(adapterSlug({ webgl: null, webgpu: null })).toBeNull();
  });
});

describe('CANON_POSITIONS', () => {
  it('places the ten canon rows backend-major in canon order, the Tier 1 pair first', () => {
    expect([...CANON_POSITIONS.entries()]).toEqual([
      ['mw120|webgpu', 1], ['sol|webgpu', 2], ['earth|webgpu', 3], ['mw50|webgpu', 4], ['lg|webgpu', 5],
      ['mw120|webgl2', 6], ['sol|webgl2', 7], ['earth|webgl2', 8], ['mw50|webgl2', 9], ['lg|webgl2', 10],
    ]);
    expect([...CANON_POSITIONS.keys()].slice(0, TIER1_SCENARIOS.length))
      .toEqual(TIER1_SCENARIOS.map((name) => `${name}|webgpu`));
  });
});

describe('pinFromRuns — one run', () => {
  it('summarises every dwell row in canon order, GPU stream where sound, each row citing its run', () => {
    const { pin, merged } = pinFromRuns(
      [runOf(file([SOL_GPU, MW120_GPU, SOL_GL]))], { ...SOURCE, accepted: { 'sol|webgpu': { bead: 'bead-1' } } },
    );
    expect(pin!.schema).toBe(PIN_SCHEMA);
    expect(pin!.adapterSlug).toBe('apple-m4-metal-3');
    expect(pin!.version).toBe('3.44.3');
    expect(pin!.takenAt).toBe('2026-09-05T20:03:00.000Z');
    expect(pin!.sourceRuns).toEqual([RUN]);
    expect(pin!.accepted['sol|webgpu'].bead).toBe('bead-1');
    expect(pin!.rows.map((r) => [r.key, r.position, r.sourceRun]))
      .toEqual([['mw120|webgpu', 1, RUN], ['sol|webgpu', 2, RUN], ['sol|webgl2', 7, RUN]]);
    expect(pin!.rows[1].gpu!.p50).toBe(21.8);
    expect(pin!.rows[0].wall.vsyncClamped).toBe(true);
    expect(pin!.rows[2].gpu).toBeNull();
    expect(pin!.rows[2].method).toBe('raf-delta');
    expect(merged!.scenarios.map((s) => s.name)).toEqual(['mw120', 'sol', 'sol']);
  });

  it('refuses the whole pin on any row it cannot stand behind', () => {
    const refused = (s: ScenarioRecord) => pinFromRuns([runOf(file([SOL_GPU, s]))], SOURCE);
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { failed: true })).pin).toBeNull();
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { mode: 'differential', dwell: null })).refusals[0])
      .toContain('dwell-mode');
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { method: 'timestamp' })).refusals[0])
      .toContain('raf-delta');
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), trending(16.9)))).refusals[0])
      .toContain('load-state transition');
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { recordCount: null })).refusals[0])
      .toContain('record count');
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { position: null })).refusals[0])
      .toContain('run position');
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { dwellAfter: dwell(stats(18.7), stats(16.9)) })).refusals[0])
      .toContain('round-trip');
  });

  // A row taken where the pin run never takes it would compare with nothing:
  // every later comparison is at equal position.
  it('refuses a row taken at a position the pin run does not take it at', () => {
    const { refusals } = pinFromRuns([runOf(file([{ ...SOL_GPU, position: 1 }]))], SOURCE);
    expect(refusals).toEqual([`sol|webgpu: ${RUN}: taken at position 1; the pin run takes sol|webgpu at 2`]);
  });

  it('pins a row whose wall clock alternates while its GPU stream holds still', () => {
    const mw50 = scenario('mw50', 'webgpu', dwell(alternatingWall(), stats(31.84)));
    const { pin, refusals } = pinFromRuns([runOf(file([mw50]))], SOURCE);
    expect(refusals).toEqual([]);
    expect(pin!.rows[0].gpu!.p50).toBe(31.84);
    expect(pin!.rows[0].wall.stateGuard).toBe('trending');
  });

  it('pins a trending ungated vantage, and still refuses the pin for a trending gated one', () => {
    const { pin, refusals } = pinFromRuns([runOf(file([SOL_GPU, LG_TRENDED]))], SOURCE);
    expect(refusals).toEqual([]);
    expect(pin!.rows.map((r) => r.key)).toEqual(['sol|webgpu', 'lg|webgpu']);
    expect(pin!.rows[1].gpu!.stateGuard).toBe('trending');

    const sol = scenario('sol', 'webgpu', dwell(stats(25.2), trending(21.8)));
    expect(pinFromRuns([runOf(file([sol, LG_TRENDED]))], SOURCE).refusals)
      .toEqual([`sol|webgpu: ${RUN}: the dwell trended across its quarters — it straddled a load-state transition`]);
  });

  it('stands the guard down at an ungated vantage on WebGL2, where wall is the gating clock', () => {
    const lgGl = scenario('lg', 'webgl2', dwell(trending(16.7), null));
    expect(pinFromRuns([runOf(file([lgGl]))], SOURCE).refusals).toEqual([]);

    const solGl = scenario('sol', 'webgl2', dwell(trending(16.7), null));
    expect(pinFromRuns([runOf(file([solGl]))], SOURCE).refusals[0]).toContain('load-state transition');
  });

  it('refuses a headed run, a run without a probe, an empty run, a cadence probe and no runs at all', () => {
    expect(pinFromRuns([runOf(file([SOL_GPU], { headless: false }))], SOURCE).refusals[0]).toContain('headed');
    expect(pinFromRuns([runOf(file([SOL_GPU], { gpu: null }))], SOURCE).refusals[0]).toContain('adapter probe');
    expect(pinFromRuns([runOf(file([]))], SOURCE).pin).toBeNull();
    expect(pinFromRuns([runOf(file([SOL_GPU, SOL_GPU]))], SOURCE).refusals[0]).toContain('cadence probe');
    expect(pinFromRuns([], SOURCE).refusals).toEqual(['no run files']);
  });

  // A single run may carry uncommitted changes: it is one tree whatever the
  // flag says. Only a merge needs the hash to prove two runs are one tree.
  it('pins a dirty single run', () => {
    expect(pinFromRuns([runOf(file([SOL_GPU], { dirty: true }))], SOURCE).refusals).toEqual([]);
  });
});

describe('pinFromRuns — several runs of one commit', () => {
  const EARTH = scenario('earth', 'webgpu', dwell(stats(16.7), stats(13.2)));
  const EARTH_TRENDED = scenario('earth', 'webgpu', dwell(stats(16.7), trending(12.8)));
  const MW120_TRENDED = scenario('mw120', 'webgpu', dwell(stats(16.7), trending(19.0)));
  const MW120_LATER = scenario('mw120', 'webgpu', dwell(stats(16.7), stats(19.4)));
  const FIRST = '.perf-runs/2026-09-13/pin.json';
  const SECOND = '.perf-runs/2026-09-13/pin-2.json';

  // The 2026-09-13 shape: run 1 refused mw120 for a first-context settle, run
  // 2 refused earth for a monotone one. Each row comes from the run that held
  // it steady, and the later run wins where both did.
  it('takes each row from the last run holding it sound, and cites that run on the row', () => {
    const { pin, refusals, provenance } = pinFromRuns([
      runOf(file([MW120_TRENDED, SOL_GPU, EARTH], { finishedAt: '2026-09-13T15:20:26.967Z' }), FIRST),
      runOf(file([MW120_LATER, SOL_GPU, EARTH_TRENDED], { finishedAt: '2026-09-13T15:51:27.653Z' }), SECOND),
    ], SOURCE);
    expect(refusals).toEqual([]);
    expect(pin!.rows.map((r) => [r.key, r.gpu!.p50, r.sourceRun])).toEqual([
      ['mw120|webgpu', 19.4, SECOND], ['sol|webgpu', 21.8, SECOND], ['earth|webgpu', 13.2, FIRST],
    ]);
    expect(pin!.sourceRuns).toEqual([FIRST, SECOND]);
    expect(pin!.takenAt).toBe('2026-09-13T15:51:27.653Z');
    expect(provenance).toEqual([
      { key: 'mw120|webgpu', sourceRun: SECOND, refusedIn: [{ sourceRun: FIRST, reason: expect.stringContaining('load-state') }] },
      { key: 'sol|webgpu', sourceRun: SECOND, refusedIn: [] },
      { key: 'earth|webgpu', sourceRun: FIRST, refusedIn: [{ sourceRun: SECOND, reason: expect.stringContaining('load-state') }] },
    ]);
  });

  it('refuses a row sound in no run, naming every run that refused it', () => {
    const { pin, refusals } = pinFromRuns([
      runOf(file([MW120_TRENDED, SOL_GPU]), FIRST),
      runOf(file([MW120_TRENDED, SOL_GPU]), SECOND),
    ], SOURCE);
    expect(pin).toBeNull();
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/^mw120\|webgpu: /);
    expect(refusals[0]).toContain(`${FIRST}: the dwell trended`);
    expect(refusals[0]).toContain(`${SECOND}: the dwell trended`);
  });

  it('fills a row a run never visited — a Tier 1 check run supplies its two', () => {
    const { pin, refusals } = pinFromRuns([
      runOf(file([MW120_TRENDED, SOL_GPU, EARTH]), FIRST),
      runOf(file([MW120_LATER, SOL_GPU]), SECOND),
    ], SOURCE);
    expect(refusals).toEqual([]);
    expect(pin!.rows.map((r) => [r.key, r.sourceRun])).toEqual([
      ['mw120|webgpu', SECOND], ['sol|webgpu', SECOND], ['earth|webgpu', FIRST],
    ]);
  });

  it('refuses runs of different commits, a dirty run among several, and runs on different GPUs', () => {
    const a = runOf(file([SOL_GPU], { commit: 'aaaa1111' }), FIRST);
    expect(pinFromRuns([a, runOf(file([SOL_GPU], { commit: 'bbbb2222' }), SECOND)], SOURCE).refusals)
      .toEqual(['the runs span commits aaaa1111, bbbb2222 — rows merge only across runs of one tree']);
    expect(pinFromRuns([a, runOf(file([SOL_GPU], { commit: 'aaaa1111', dirty: true }), SECOND)], SOURCE).refusals[0])
      .toBe(`${SECOND}: a dirty tree — two runs at one hash with uncommitted changes need not be one tree`);
    const m3: AdapterProbe = { ...M4, webgl: { ...M4.webgl!, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)' } };
    expect(pinFromRuns([a, runOf(file([SOL_GPU], { commit: 'aaaa1111', gpu: m3 }), SECOND)], SOURCE).refusals[0])
      .toContain('span adapters apple-m4-metal-3, apple-m3-max-metal-3');
  });

  it('merges into one run the pin being replaced can judge', () => {
    const old = pinOf([SOL_GPU, EARTH]);
    const { merged } = pinFromRuns([
      runOf(file([scenario('sol', 'webgpu', dwell(stats(25.2), stats(22.6)))]), FIRST),
      runOf(file([EARTH]), SECOND),
    ], SOURCE);
    const diff = compareToPin(old, merged!);
    expect(diff.refusals).toEqual([]);
    expect(diff.rows.map((r) => [r.key, r.verdict])).toEqual([['sol|webgpu', 'dearer'], ['earth|webgpu', 'same']]);
  });
});

describe('missingCanonRows and pinWriteRefusal — the whole canon, or nothing', () => {
  it('names the canon rows a pin lacks, in canon order', () => {
    expect(missingCanonRows(pinOf([SOL_GPU, SOL_GL]))).toEqual([
      'mw120|webgpu', 'earth|webgpu', 'mw50|webgpu', 'lg|webgpu',
      'mw120|webgl2', 'earth|webgl2', 'mw50|webgl2', 'lg|webgl2',
    ]);
    expect(missingCanonRows(pinOf(wholeCanon()))).toEqual([]);
  });

  it('refuses an incomplete pin before anything else', () => {
    expect(pinWriteRefusal(pinOf([SOL_GPU]), null)).toContain('would lack mw120|webgpu, earth|webgpu');
  });

  it('refuses a ✗ against the pin being replaced unless the new pin accepts it, and clears otherwise', () => {
    const old = pinOf(wholeCanon(20));
    const dearer = pinFromRuns([runOf(file(wholeCanon(20.5)))], SOURCE);
    const against = compareToPin(old, dearer.merged!);
    expect(against.rows.filter((r) => r.verdict === 'dearer')).toHaveLength(4);
    expect(pinWriteRefusal(dearer.pin!, against)).toContain('marked ✗ against the pin being replaced');

    const accepted = Object.fromEntries(
      ['mw120', 'sol', 'earth', 'mw50'].map((name) => [`${name}|webgpu`, { bead: 'bead-9' }]),
    );
    const withAccept = pinFromRuns([runOf(file(wholeCanon(20.5)))], { ...SOURCE, accepted });
    expect(pinWriteRefusal(withAccept.pin!, against)).toBeNull();
    expect(pinWriteRefusal(pinOf(wholeCanon(20)), null)).toBeNull();
  });
});

describe('compareToPin', () => {
  it('calls a run against its own pin unchanged, on the GPU stream where the pin has one', () => {
    const diff = compareToPin(pinOf(), file([SOL_GPU, MW120_GPU, SOL_GL]));
    expect(diff.refusedWholeRun).toBeNull();
    expect(diff.refusals).toEqual([]);
    expect(diff.rows.map((r) => [r.key, r.metric, r.verdict])).toEqual([
      ['sol|webgpu', 'gpu-p50', 'same'],
      ['mw120|webgpu', 'gpu-p50', 'same'],
      ['sol|webgl2', 'wall-p50', 'ungated'],
    ]);
    expect(diff.rows[0].bandMs).toBe(dwellFloorMs(21.8));
    expect(pinDiffFails(diff)).toBe(false);
  });

  it('marks a GPU-stream move past the floor dearer, and one inside it not at all', () => {
    const dearer = scenario('sol', 'webgpu', dwell(stats(25.2), stats(22.15)));
    const inside = scenario('sol', 'webgpu', dwell(stats(25.2), stats(22.0)));
    expect(compareToPin(pinOf([SOL_GPU]), file([dearer])).rows[0].verdict).toBe('dearer');
    expect(compareToPin(pinOf([SOL_GPU]), file([inside])).rows[0].verdict).toBe('same');
    const cheaper = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.4)));
    expect(compareToPin(pinOf([SOL_GPU]), file([cheaper])).rows[0].verdict).toBe('cheaper');
  });

  it('names lg alone as ungated, carrying the reason the row note prints', () => {
    expect(PIN_UNGATED_SCENARIOS)
      .toEqual({ lg: 'wanders as much inside one dwell as between runs' });
  });

  it('records lg and never marks it below the ceiling, at the full 1.47 ms it moved', () => {
    const diff = compareToPin(pinOf([LG_GPU]), file([lgAt(13.36)]));
    const row = diff.rows[0];
    expect([row.metric, row.verdict]).toEqual(['gpu-p50', 'ungated']);
    expect(row.currentMs).toBe(13.36);
    expect(row.bandMs).toBe(0);
    expect(row.note).toContain(PIN_UNGATED_SCENARIOS.lg);
    expect(pinDiffFails(diff)).toBe(false);
  });

  it('records a trending lg rather than refusing it, and the ceiling still reaches that row', () => {
    const diff = compareToPin(pinOf([LG_GPU]), file([LG_TRENDED]));
    expect(diff.refusals).toEqual([]);
    expect([diff.rows[0].verdict, diff.rows[0].currentMs]).toEqual(['ungated', 12.5]);
    expect(pinDiffFails(diff)).toBe(false);

    const hot = scenario('lg', 'webgpu', dwell(stats(16.7), trending(33.5)));
    expect(compareToPin(pinOf([LG_GPU]), file([hot])).rows[0].verdict).toBe('dearer');
  });

  it('marks lg over the ceiling: ungated by the band is not ungated by the bound', () => {
    const diff = compareToPin(pinOf([LG_GPU]), file([lgAt(33.5)]));
    expect(diff.rows[0].verdict).toBe('dearer');
    expect(diff.rows[0].note).toContain('33.4 ms ceiling');
    expect(pinDiffFails(diff)).toBe(true);
    expect(unacceptedMarks(diff, {})).toEqual(['lg|webgpu']);
  });

  it('never marks on the wall clock: the cadence may move under a steady GPU stream', () => {
    const left = scenario('mw120', 'webgpu', dwell(stats(21.6), stats(21.0)));
    const row = compareToPin(pinOf([MW120_GPU]), file([left])).rows[0];
    expect(row.metric).toBe('gpu-p50');
    expect(row.verdict).toBe('same');

    const onto = scenario('sol', 'webgl2', dwell(stats(16.7, { iqrMs: 0.4, vsyncClamped: true }), null));
    expect(compareToPin(pinOf([SOL_GL]), file([onto])).rows[0].verdict).toBe('ungated');
  });

  it('records a row with no GPU stream and never gates it, naming the side that lacks one', () => {
    const row = compareToPin(pinOf([SOL_GL]), file([SOL_GL])).rows[0];
    expect([row.metric, row.verdict]).toEqual(['wall-p50', 'ungated']);
    expect(row.note).toContain('WebGL2 supplies none');
    expect(row.bandMs).toBe(0);

    const lost = scenario('sol', 'webgpu', dwell(stats(25.2), null));
    expect(compareToPin(pinOf([SOL_GPU]), file([lost])).rows[0].note)
      .toContain('this run resolved none');
    const gained = scenario('sol', 'webgl2', dwell(stats(16.0, { iqrMs: 21 }), stats(15.2)));
    expect(compareToPin(pinOf([SOL_GL]), file([gained])).rows[0].note).toContain('this run does');
  });

  it('marks a GPU-stream p50 over the ceiling regardless of the band, and reads wall never', () => {
    expect(PIN_CEILING_MS).toBe(33.4);
    const hot = scenario('sol', 'webgpu', dwell(stats(25.2), stats(33.5)));
    const row = compareToPin(pinOf([SOL_GPU]), file([hot])).rows[0];
    expect(row.verdict).toBe('dearer');
    expect(row.note).toContain('33.4 ms ceiling');

    // Wall p50 is quantised to the refresh interval, so it can sit far over
    // the ceiling while the hardware time the gate reads is well under it.
    const slowWall = scenario('sol', 'webgpu', dwell(stats(50.1), stats(21.8)));
    expect(compareToPin(pinOf([SOL_GPU]), file([slowWall])).rows[0].verdict).toBe('same');
  });

  it('refuses the whole run on another GPU or a headed browser', () => {
    const other: AdapterProbe = { ...M4, webgl: { ...M4.webgl!, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max, Unspecified Version)' } };
    expect(compareToPin(pinOf(), file([SOL_GPU], { gpu: other })).refusedWholeRun).toContain('apple-m3-max-metal-3');
    expect(compareToPin(pinOf(), file([SOL_GPU], { headless: false })).refusedWholeRun).toContain('headed');
  });

  it('refuses a row that trended or was measured at another buffer, and lists the pin rows the run never visited', () => {
    const trended = scenario('sol', 'webgpu', dwell(stats(25.2), trending(21.8)));
    const resized = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)), { bufferMpx: 4.096 * (1 + 2 * BUFFER_MPX_TOLERANCE) });
    const diff = compareToPin(pinOf(), file([trended]));
    expect(diff.rows).toEqual([]);
    expect(diff.refusals.map((r) => r.key)).toEqual(['sol|webgpu']);
    expect(diff.refusals[0].reason).toContain('load-state transition');
    expect(diff.unmeasured).toEqual(['mw120|webgpu', 'sol|webgl2']);
    expect(compareToPin(pinOf([SOL_GPU]), file([resized])).refusals[0].reason).toContain('Mpx');
  });

  // Tier 1 visits two of the pin's ten contexts and answers for those two.
  it('does not fail a run for the pin rows it did not measure', () => {
    const diff = compareToPin(pinOf(), file([SOL_GPU]));
    expect(diff.rows.map((r) => r.key)).toEqual(['sol|webgpu']);
    expect(diff.refusals).toEqual([]);
    expect(diff.unmeasured).toEqual(['mw120|webgpu', 'sol|webgl2']);
    expect(pinDiffFails(diff)).toBe(false);
  });

  // A scenario that never booted keys as `<name>|unbooted`, which no pin can
  // hold — so the key lookup would answer "not in the pin" about a row whose
  // trouble is that it failed. The failure is the reason worth printing.
  it('names the failure, not the absent key, for a scenario that never booted', () => {
    const unbooted = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)), {
      backend: { requested: 'webgpu', actual: null }, failed: true,
    });
    const diff = compareToPin(pinOf(), file([unbooted]));
    expect(diff.refusals).toEqual([{ key: 'sol|unbooted', reason: 'the scenario failed or was tainted' }]);
    expect(pinDiffFails(diff)).toBe(true);
  });

  it('refuses a row the run measured and the pin does not hold', () => {
    const diff = compareToPin(pinOf([SOL_GPU]), file([SOL_GPU, MW120_GPU]));
    expect(diff.rows.map((r) => r.key)).toEqual(['sol|webgpu']);
    expect(diff.refusals).toEqual([{ key: 'mw120|webgpu', reason: 'not in the pin — nothing to judge it against' }]);
    expect(pinDiffFails(diff)).toBe(true);
  });

  // The pin run visits mw120|webgpu first and sol|webgpu second, which is
  // the Tier 1 run's own shape — so those two rows compare and a row taken
  // deeper into a run does not.
  it('compares a row only against one taken at the same position in its run', () => {
    const pin = pinOf([MW120_GPU, SOL_GPU, SOL_GL]);
    const tier1 = compareToPin(pin, file([MW120_GPU, SOL_GPU]));
    expect(tier1.refusals).toEqual([]);
    expect(tier1.rows.map((r) => [r.key, r.verdict])).toEqual([['mw120|webgpu', 'same'], ['sol|webgpu', 'same']]);
    expect(tier1.unmeasured).toEqual(['sol|webgl2']);

    const deeper = compareToPin(pin, file([{ ...SOL_GPU, position: 8 }]));
    expect(deeper.rows).toEqual([]);
    expect(deeper.refusals[0].reason).toContain('run position 2 vs 8');
    expect(pinDiffFails(deeper)).toBe(true);
  });

  it('compares a row whose wall clock alternates but whose GPU stream is steady', () => {
    const mw50 = (gpuP50: number) => scenario('mw50', 'webgpu', dwell(alternatingWall(), stats(gpuP50)));
    const diff = compareToPin(pinOf([mw50(31.84)]), file([mw50(31.85)]));
    expect(diff.refusals).toEqual([]);
    expect(diff.rows[0].metric).toBe('gpu-p50');
    expect(diff.rows[0].verdict).toBe('same');
  });

  it('refuses a row priced against a different catalogue', () => {
    const grown = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)), { recordCount: RECORDS + 54458 });
    const diff = compareToPin(pinOf([SOL_GPU]), file([grown]));
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain(`${RECORDS} vs ${RECORDS + 54458} records`);
    expect(pinDiffFails(diff)).toBe(true);
  });

  // The bound perf-section-check.sh requires a re-take past. Below it a
  // membership change ships with no `## Perf` section, so the pin it leaves
  // behind has to stay usable or every later render-path PR is blocked.
  it('still compares a row whose catalogue moved less than the tolerance', () => {
    const nudged = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)), {
      recordCount: RECORDS + Math.floor(RECORDS * RECORD_COUNT_TOLERANCE) - 1,
    });
    const diff = compareToPin(pinOf([SOL_GPU]), file([nudged]));
    expect(diff.refusals).toEqual([]);
    expect(diff.rows[0].metric).toBe('gpu-p50');
    expect(pinDiffFails(diff)).toBe(false);
  });
});

describe('parseRenderPathDrift', () => {
  it('reads a full shortstat line', () => {
    expect(parseRenderPathDrift(' 42 files changed, 1600 insertions(+), 30 deletions(-)'))
      .toEqual({ files: 42, insertions: 1600, deletions: 30 });
  });

  it('reads a clause git omits when its count is zero', () => {
    expect(parseRenderPathDrift(' 3 files changed, 12 insertions(+)'))
      .toEqual({ files: 3, insertions: 12, deletions: 0 });
    expect(parseRenderPathDrift(' 2 files changed, 7 deletions(-)'))
      .toEqual({ files: 2, insertions: 0, deletions: 7 });
    expect(parseRenderPathDrift(' 1 file changed, 1 insertion(+), 1 deletion(-)'))
      .toEqual({ files: 1, insertions: 1, deletions: 1 });
  });

  it('reads an empty line as a measured zero, not as a failure to measure', () => {
    expect(parseRenderPathDrift('')).toEqual({ files: 0, insertions: 0, deletions: 0 });
    expect(parseRenderPathDrift('\n')).toEqual({ files: 0, insertions: 0, deletions: 0 });
  });

  it('returns null on anything it cannot read', () => {
    expect(parseRenderPathDrift('fatal: bad revision')).toBeNull();
  });
});

describe('commitStateFromExitStatus — only exit 1 is an answer', () => {
  it('reads a clean exit as landed and exit 1 as unlanded', () => {
    expect(commitStateFromExitStatus(0)).toBe('landed');
    expect(commitStateFromExitStatus(1)).toBe('unlanded');
  });

  it('reads every other status as unknown, never as unlanded', () => {
    // 128 is git's "bad object / no such ref" — the question failed rather
    // than being answered no, and a confident "pre-squash tip" line about a
    // commit git never resolved is the thing this separation prevents.
    for (const status of [128, 129, 2, -1, undefined]) {
      expect(commitStateFromExitStatus(status), `status ${status}`).toBe('unknown');
    }
  });
});

describe('pinProvenanceLines — what the pin measured, before any row is read', () => {
  const pin = pinOf([SOL_GPU]);
  const onMain = { ...pin, git: { ...pin.git, commit: 'landed7', mainCommit: 'base1234' } };
  const RUN_BASE = 'runbase9';
  const NO_DRIFT = { files: 0, insertions: 0, deletions: 0 };

  it('says nothing when the commit landed and main has not moved under src/client', () => {
    expect(pinProvenanceLines(onMain, 'landed', NO_DRIFT, RUN_BASE)).toEqual([]);
  });

  it('names a pre-squash tip that no hash on main carries', () => {
    const lines = pinProvenanceLines(onMain, 'unlanded', NO_DRIFT, RUN_BASE);
    expect(lines[0]).toContain('not an ancestor of origin/main');
    expect(lines[0]).toContain('pre-squash branch tip');
  });

  it('quotes the render-path difference a mark might really be', () => {
    const lines = pinProvenanceLines(onMain, 'unlanded', { files: 42, insertions: 1600, deletions: 30 }, RUN_BASE);
    expect(lines[1]).toContain('42 files, +1600/-30');
    expect(lines[1]).toContain('may be that difference rather than this diff');
  });

  // The counts are `git diff <pin base> <run base>`, so they read in that
  // direction whichever tree is older. Naming both ends is what keeps the
  // line true for a branch cut BEFORE the pin was taken, where "main moved
  // since the pin" would have the insertions and deletions the wrong way up.
  it('names both bases and the direction, rather than claiming main moved forward', () => {
    const lines = pinProvenanceLines(onMain, 'landed', { files: 3, insertions: 9, deletions: 1 }, RUN_BASE);
    expect(lines[0]).toContain("from the pin's base base1234 to this run's runbase9");
    expect(lines[0]).not.toContain('moved');
  });

  it('still reads without a run base to name', () => {
    const lines = pinProvenanceLines(onMain, 'landed', { files: 3, insertions: 9, deletions: 1 }, null);
    expect(lines[0]).toContain("to this run's unrecorded base");
  });

  it('says so when the pin records no main base at all', () => {
    const based = { ...pin, git: { ...pin.git, mainCommit: null } };
    expect(pinProvenanceLines(based, 'unlanded', null, RUN_BASE).at(-1)).toContain('cannot be measured at all');
  });

  it('separates an unreadable ancestry from a known-unlanded one', () => {
    expect(pinProvenanceLines(onMain, 'unknown', null, RUN_BASE)[0]).toContain('drift is unbounded');
  });
});

describe('pinDiffFails — a refused comparison is not a pass', () => {
  it('fails on a ✗ row, on a whole-run refusal, and on a per-row refusal', () => {
    const dearer = scenario('sol', 'webgpu', dwell(stats(25.2), stats(22.6)));
    expect(pinDiffFails(compareToPin(pinOf([SOL_GPU]), file([dearer])))).toBe(true);
    expect(pinDiffFails(compareToPin(pinOf(), file([SOL_GPU], { headless: false })))).toBe(true);

    // Every row refused prints a table with no ✗ in it, which would read as
    // a clean run if only the marks were counted.
    const trended = scenario('sol', 'webgpu', dwell(stats(25.2), trending(21.8)));
    const allRefused = compareToPin(pinOf([SOL_GPU]), file([trended]));
    expect(allRefused.rows).toEqual([]);
    expect(pinDiffFails(allRefused)).toBe(true);
  });

  it('passes a run whose only unmarked rows are ungated', () => {
    expect(pinDiffFails(compareToPin(pinOf([SOL_GL]), file([SOL_GL])))).toBe(false);
  });
});

describe('unacceptedMarks — writing a pin must not ratchet the frame upward', () => {
  it('names every ✗ no --accept covers, and nothing once one does', () => {
    const dearer = scenario('sol', 'webgpu', dwell(stats(25.2), stats(22.6)));
    const diff = compareToPin(pinOf([SOL_GPU]), file([dearer]));
    expect(unacceptedMarks(diff, {})).toEqual(['sol|webgpu']);
    expect(unacceptedMarks(diff, { 'sol|webgpu': { bead: 'bead-7' } })).toEqual([]);
    expect(unacceptedMarks(diff, { 'mw120|webgpu': { bead: 'other' } })).toEqual(['sol|webgpu']);
  });

  it('never asks acceptance of a cheaper, unchanged or ungated row', () => {
    const cheaper = scenario('sol', 'webgpu', dwell(stats(25.2), stats(20.9)));
    expect(unacceptedMarks(compareToPin(pinOf([SOL_GPU]), file([cheaper])), {})).toEqual([]);
    expect(unacceptedMarks(compareToPin(pinOf([SOL_GL]), file([SOL_GL])), {})).toEqual([]);
  });
});

describe('citeRunPath — the pin ships in a public repo', () => {
  it('cites a run under the main checkout by its repo-relative path', () => {
    expect(citeRunPath('/Users/alexm/github/stellata/.perf-runs/2026-09-05/pin.json', '/Users/alexm/github/stellata'))
      .toBe('.perf-runs/2026-09-05/pin.json');
  });

  it('keeps the name and drops the location of a run stored elsewhere', () => {
    expect(citeRunPath('/tmp/scratch/pin.json', '/Users/alexm/github/stellata')).toBe('pin.json');
  });
});

describe('assertPinFile and the path', () => {
  it('refuses a foreign schema by name', () => {
    expect(() => assertPinFile({ schema: 'stellata-perf/1', run: {} }, 'x.json')).toThrow(PinError);
    expect(assertPinFile(pinOf(), 'x.json').adapterSlug).toBe('apple-m4-metal-3');
  });

  it('files one pin per adapter under scripts/perf/pins', () => {
    expect(pinPathFor('apple-m4-metal-3')).toBe('scripts/perf/pins/apple-m4-metal-3.json');
  });
});

describe('the exposure readback duty cycle', () => {
  const countsOf = (max: number, min = 4): DwellRecord['passCounts'] => ({
    perFrame: { submits: [], commandBuffers: [], renderPasses: [], computePasses: [] },
    summary: {
      submits: { min, p50: min, max },
      commandBuffers: { min, p50: min, max },
      renderPasses: { min, p50: min, max },
      computePasses: { min: 0, p50: 0, max: 0 },
    },
    note: 'counted',
  });

  const SPLIT = countsOf(10);
  const FLAT = countsOf(4);

  const at = (
    name: ScenarioName, gpuP50: number, readbackPerFrame: number, passCounts: DwellRecord['passCounts'],
  ): ScenarioRecord => scenario(name, 'webgpu', {
    deltasMs: [],
    gpuMs: [],
    gpuNote: 'sound',
    stats: stats(16.7),
    gpuStats: stats(gpuP50),
    limitMag: 1.511,
    dm: -11.852,
    readbackPerFrame,
    passCounts,
  });

  it('records the rate the row was taken at', () => {
    const pin = pinOf([at('earth', 17.157, 0.25, SPLIT)]);
    expect(pin.rows[0].readbackPerFrame).toBe(0.25);
  });

  it('records whether the pinned dwell drew two classes of frame', () => {
    expect(pinOf([at('earth', 17.157, 0.25, SPLIT)]).rows[0].splitFrame).toBe(true);
    expect(pinOf([at('sol', 22.406, 0.25, FLAT)]).rows[0].splitFrame).toBe(false);
  });

  // The duty cycle erases its own evidence as it approaches 1: every frame
  // becomes a readback frame, the counters read flat, and a guard reading the
  // run alone would stand down on the largest move it exists to catch. The
  // archive already holds rates up to 0.975. `--baseline` ors both sides; this
  // is what lets the pin do the same.
  it('refuses on the pin’s own split where the run’s counters read flat', () => {
    const diff = compareToPin(
      pinOf([at('earth', 17.157, 0.25, SPLIT)]),
      file([at('earth', 52.854, 0.975, countsOf(10, 10))]),
    );
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('samples only the readback frames');
    expect(pinDiffFails(diff)).toBe(true);
  });

  // A pin taken before the field existed reads as the run's own verdict, which
  // is what the gate did before this row was carried at all.
  it('falls back to the run’s counters where the pin holds no split', () => {
    const pin = pinOf([at('earth', 17.157, 0.25, SPLIT)]);
    const older: PinFile = { ...pin, rows: pin.rows.map(({ splitFrame, ...rest }) => rest) };
    const diff = compareToPin(older, file([at('earth', 52.854, 0.5792, SPLIT)]));
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('samples only the readback frames');
  });

  it('refuses a two-class row whose rate left the pin', () => {
    const diff = compareToPin(pinOf([at('earth', 17.157, 0.25, SPLIT)]), file([at('earth', 52.854, 0.5792, SPLIT)]));
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('samples only the readback frames');
    expect(pinDiffFails(diff)).toBe(true);
  });

  it('marks a one-class row whose rate moved just as far', () => {
    const diff = compareToPin(pinOf([at('sol', 22.406, 0.25, FLAT)]), file([at('sol', 13.076, 0.5917, FLAT)]));
    expect(diff.refusals).toEqual([]);
    expect(diff.rows[0].verdict).toBe('cheaper');
    expect(diff.rows[0].deltaMs).toBeCloseTo(-9.33, 5);
  });

  // A pin whose rows predate the field still gates every row it always did:
  // the guard declines, rather than refusing the whole comparison until a
  // cold re-take is spent on it.
  it('declines where the pin holds no rate for the row', () => {
    const pin = pinOf([at('earth', 17.157, 0.25, SPLIT)]);
    const older: PinFile = {
      ...pin,
      rows: pin.rows.map(({ readbackPerFrame, ...rest }) => rest),
    };
    const diff = compareToPin(older, file([at('earth', 52.854, 0.5792, SPLIT)]));
    expect(diff.refusals).toEqual([]);
    expect(diff.rows[0].verdict).toBe('dearer');
  });
});
