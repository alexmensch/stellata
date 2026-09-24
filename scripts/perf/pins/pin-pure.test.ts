import { describe, expect, it } from 'vitest';
import { medianStandardErrorMs } from '../../../src/client/debug/frame-cost/frame-cost-pure';
import { BUFFER_MPX_TOLERANCE, RECORD_COUNT_TOLERANCE, computeFloorMs, dwellFloorMs } from '../diff/diff-pure';
import { frameFloor, type DwellSummary } from '../dwell/dwell-pure';
import {
  BAND_OVER_FLOOR_FACTOR,
  CANON_POSITIONS,
  FLOOR_FOLLOWS_FRACTION,
  PIN_CEILING_MS,
  PIN_SCHEMA,
  PIN_UNGATED_SCENARIOS,
  PinError,
  adapterSlug,
  assertPinFile,
  compareToPin,
  missingCanonRows,
  pinDiffFails,
  pinFromRuns,
  pinPathFor,
  pinWriteRefusal,
  unacceptedMarks,
  type PinFile,
} from './pin-pure';
import { PERF_SCHEMA, type AdapterProbe, type DwellRecord, type PerfFile, type ScenarioRecord } from '../schema';
import { BACKENDS, SCENARIO_NAMES, TIER1_SCENARIOS, type Backend, type ScenarioName } from '../scenarios';

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
    deltasMs: [], gpuMs: gpu === null ? null : [], gpuNote: gpu === null ? 'no query set' : 'sound',
    stats: wall, gpuStats: gpu, limitMag: 1.511, dm: -6.289, readbackPerFrame: 0.25, passCounts: null,
  };
}

/** A WebGPU dwell carrying the compute stream beside the frame's. */
function withCompute(record: DwellRecord, compute: DwellSummary, computeMs: readonly number[] = [compute.p50]): DwellRecord {
  return { ...record, computeMs, computeStats: compute };
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
/** A canon row with wall time and no GPU stream at all. */
const EARTH_NO_STREAM = scenario('earth', 'webgpu', dwell(stats(16.0, { iqrMs: 21 }), null));

/** The pinned lg row and a later one, at the wall clock lg actually reads:
 *  quantised to the refresh interval whatever the GPU stream does. */
const lgAt = (gpuP50: number) => scenario('lg', 'webgpu', dwell(stats(16.7), stats(gpuP50)));
const LG_GPU = lgAt(11.891);
const LG_TRENDED = scenario('lg', 'webgpu', dwell(stats(16.7), trending(12.5)));
const RUN = '.perf-runs/2026-09-05/pin.json';
const SOURCE = { version: '3.44.3', accepted: {} };

const runOf = (perf: PerfFile, sourceRun = RUN) => ({ file: perf, sourceRun });

function pinOf(scenarios: readonly ScenarioRecord[] = [SOL_GPU, MW120_GPU, EARTH_NO_STREAM]): PinFile {
  const { pin, refusals } = pinFromRuns([runOf(file(scenarios))], SOURCE);
  expect(refusals).toEqual([]);
  return pin!;
}

/** Every canon row, steady, so a pin is complete. */
function wholeCanon(gpuP50 = 20): ScenarioRecord[] {
  return BACKENDS.flatMap((backend) => SCENARIO_NAMES.map((name) =>
    scenario(name, backend, dwell(stats(16.7), stats(gpuP50)))));
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
  it('places the five canon rows in canon order, the Tier 1 pair first', () => {
    expect([...CANON_POSITIONS.entries()]).toEqual([
      ['mw120|webgpu', 1], ['sol|webgpu', 2], ['earth|webgpu', 3], ['mw50|webgpu', 4], ['lg|webgpu', 5],
    ]);
    expect([...CANON_POSITIONS.keys()].slice(0, TIER1_SCENARIOS.length))
      .toEqual(TIER1_SCENARIOS.map((name) => `${name}|webgpu`));
  });
});

describe('pinFromRuns — one run', () => {
  it('summarises every dwell row in canon order, GPU stream where sound, each row citing its run', () => {
    const { pin, merged } = pinFromRuns(
      [runOf(file([SOL_GPU, MW120_GPU, EARTH_NO_STREAM]))], { ...SOURCE, accepted: { 'sol|webgpu': { bead: 'bead-1' } } },
    );
    expect(pin!.schema).toBe(PIN_SCHEMA);
    expect(pin!.adapterSlug).toBe('apple-m4-metal-3');
    expect(pin!.version).toBe('3.44.3');
    expect(pin!.takenAt).toBe('2026-09-05T20:03:00.000Z');
    expect(pin!.sourceRuns).toEqual([RUN]);
    expect(pin!.accepted['sol|webgpu'].bead).toBe('bead-1');
    expect(pin!.rows.map((r) => [r.key, r.position, r.sourceRun]))
      .toEqual([['mw120|webgpu', 1, RUN], ['sol|webgpu', 2, RUN], ['earth|webgpu', 3, RUN]]);
    expect(pin!.rows[1].gpu!.p50).toBe(21.8);
    expect(pin!.rows[0].wall.vsyncClamped).toBe(true);
    expect(pin!.rows[2].gpu).toBeNull();
    expect(pin!.rows[2].method).toBe('raf-delta');
    expect(merged!.scenarios.map((s) => s.name)).toEqual(['mw120', 'sol', 'earth']);
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

  it('leaves a row at no canon position out of the pin and names it in dropped', () => {
    const archived = {
      ...scenario('sol', 'webgpu', dwell(stats(24.0), stats(20.0))),
      backend: { requested: 'webgl2', actual: 'webgl2' },
      position: 7,
    } as unknown as ScenarioRecord;
    const { pin, merged, refusals, dropped } = pinFromRuns([runOf(file([SOL_GPU, archived]))], SOURCE);
    expect(refusals).toEqual([]);
    expect(pin!.rows.map((r) => r.key)).toEqual(['sol|webgpu']);
    expect(merged!.scenarios).toEqual([SOL_GPU]);
    expect(dropped).toEqual(['sol|webgl2']);
  });

  it('drops nothing from a run holding canon rows alone', () => {
    expect(pinFromRuns([runOf(file([SOL_GPU, MW120_GPU]))], SOURCE).dropped).toEqual([]);
  });

  // A dwell under --force-recompute marches every star every frame, which lands
  // on the compute row. Pinned, that lever's cost would ride in every later
  // run's verdict — the ratchet /RELEASING.md#perf-pin exists to stop.
  it('refuses a run taken under a setup lever, so the lever cannot be written into the pin', () => {
    const forced = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)), {
      params: { forceRecompute: true },
    });
    const { pin, refusals } = pinFromRuns([runOf(file([forced]))], SOURCE);
    expect(pin).toBeNull();
    expect(refusals[0]).toContain('extinction recompute gated vs forced');
  });

  it('pins a run that recorded the lever off, which every dwell now stamps', () => {
    const off = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)), {
      params: { forceRecompute: false, readbackEvery: 4 },
    });
    expect(pinFromRuns([runOf(file([off]))], SOURCE).refusals).toEqual([]);
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

  it('stands the guard down at an ungated vantage with no GPU stream', () => {
    const lgNoStream = scenario('lg', 'webgpu', dwell(trending(16.7), null));
    expect(pinFromRuns([runOf(file([lgNoStream]))], SOURCE).refusals).toEqual([]);

    const solNoStream = scenario('sol', 'webgpu', dwell(trending(16.7), null));
    expect(pinFromRuns([runOf(file([solNoStream]))], SOURCE).refusals[0]).toContain('load-state transition');
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

  const OLDER = '2026-09-13T15:20:26.967Z';
  const NEWER = '2026-09-13T15:51:27.653Z';

  // The 2026-09-13 shape: run 1 refused mw120 for a first-context settle, run
  // 2 refused earth for a monotone one. Each row comes from the run that held
  // it steady, and the newer run wins where both did.
  it('takes each row from the newest run holding it sound, and cites that run on the row', () => {
    const { pin, refusals, provenance } = pinFromRuns([
      runOf(file([MW120_TRENDED, SOL_GPU, EARTH], { finishedAt: OLDER }), FIRST),
      runOf(file([MW120_LATER, SOL_GPU, EARTH_TRENDED], { finishedAt: NEWER }), SECOND),
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

  // Naming them the other way round used to move eight of ten rows to the
  // older run while takenAt stayed the newer one's, so the pin claimed a take
  // time most of its rows predated — silently, since only the per-row
  // sourceRun showed it.
  it('writes the same pin whatever order the runs are named in', () => {
    const older = runOf(file([MW120_TRENDED, SOL_GPU, EARTH], { finishedAt: OLDER }), FIRST);
    const newer = runOf(file([MW120_LATER, SOL_GPU, EARTH_TRENDED], { finishedAt: NEWER }), SECOND);
    const forwards = pinFromRuns([older, newer], SOURCE);
    const backwards = pinFromRuns([newer, older], SOURCE);
    expect(backwards.pin).toEqual(forwards.pin);
    expect(backwards.pin!.sourceRuns).toEqual([FIRST, SECOND]);
    expect(backwards.pin!.takenAt).toBe(NEWER);
    expect(backwards.pin!.rows.map((r) => r.sourceRun)).toEqual([SECOND, SECOND, FIRST]);
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

describe('the floor beside the median', () => {
  // Twenty frames 18.80..19.75 in 0.05 steps: nearest-rank p10 is 18.85.
  const STEADY = Array.from({ length: 20 }, (_, i) => 18.8 + i * 0.05);
  const withGpu = (p50: number, gpuMs: readonly number[]) =>
    scenario('mw120', 'webgpu', { ...dwell(stats(16.7), stats(p50)), gpuMs });

  it('reads the tenth-percentile frame off the raw samples, or nothing off none', () => {
    expect(frameFloor(STEADY)).toEqual({ p10: 18.85 });
    expect(frameFloor([])).toBeNull();
    expect(frameFloor(null)).toBeNull();
  });

  it('records the GPU floor on the pinned row, and none where the row has no samples', () => {
    expect(pinOf([withGpu(18.99, STEADY)]).rows[0].gpuFloor).toEqual({ p10: 18.85 });
    expect(pinOf([MW120_GPU]).rows[0].gpuFloor).toBeNull();
    expect(pinOf([EARTH_NO_STREAM]).rows[0].gpuFloor).toBeNull();
  });

  // The 2026-09-13 false mark: the median rose 0.43 past a 0.25 band while the
  // fastest frames stayed put — only the slow half moved.
  it('prints an unmoved floor on a ✗ and says the upper half alone rose, without changing the verdict', () => {
    const wander = STEADY.map((x, i) => (i < 10 ? x : x + 0.9));
    const row = compareToPin(pinOf([withGpu(18.99, STEADY)]), file([withGpu(19.42, wander)])).rows[0];
    expect(row.verdict).toBe('dearer');
    expect(row.deltaMs).toBeCloseTo(0.43, 6);
    expect(row.floorDeltaMs).toBe(0);
    expect(row.note).toBe('floor moved 0.000 of 0.430 — the upper half alone rose; read the quarters before accepting');
  });

  it('leaves the note empty when the floor followed the median, as a per-frame cost does', () => {
    const dearer = STEADY.map((x) => x + 0.5);
    const row = compareToPin(pinOf([withGpu(18.99, STEADY)]), file([withGpu(19.49, dearer)])).rows[0];
    expect(row.verdict).toBe('dearer');
    expect(row.floorDeltaMs).toBeCloseTo(0.5, 6);
    expect(row.note).toBe('');
    expect(FLOOR_FOLLOWS_FRACTION).toBe(0.25);
  });

  it('prints no floor where either side lacks samples, and never on a wall row', () => {
    expect(compareToPin(pinOf([MW120_GPU]), file([withGpu(21.0, STEADY)])).rows[0].floorDeltaMs).toBeNull();
    expect(compareToPin(pinOf([withGpu(21.0, STEADY)]), file([MW120_GPU])).rows[0].floorDeltaMs).toBeNull();
    expect(compareToPin(pinOf([EARTH_NO_STREAM]), file([EARTH_NO_STREAM])).rows[0].floorDeltaMs).toBeNull();
  });
});

describe('missingCanonRows and pinWriteRefusal — the whole canon, or nothing', () => {
  it('names the canon rows a pin lacks, in canon order', () => {
    expect(missingCanonRows(pinOf([SOL_GPU, EARTH_NO_STREAM]))).toEqual([
      'mw120|webgpu', 'mw50|webgpu', 'lg|webgpu',
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
    const diff = compareToPin(pinOf(), file([SOL_GPU, MW120_GPU, EARTH_NO_STREAM]));
    expect(diff.refusedWholeRun).toBeNull();
    expect(diff.refusals).toEqual([]);
    expect(diff.rows.map((r) => [r.key, r.metric, r.verdict])).toEqual([
      ['sol|webgpu', 'gpu-p50', 'same'],
      ['mw120|webgpu', 'gpu-p50', 'same'],
      ['earth|webgpu', 'wall-p50', 'ungated'],
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

    const onto = scenario('earth', 'webgpu', dwell(stats(16.7, { iqrMs: 0.4, vsyncClamped: true }), null));
    expect(compareToPin(pinOf([EARTH_NO_STREAM]), file([onto])).rows[0].verdict).toBe('ungated');
  });

  it('records a row with no GPU stream and never gates it, naming the side that lacks one', () => {
    const row = compareToPin(pinOf([EARTH_NO_STREAM]), file([EARTH_NO_STREAM])).rows[0];
    expect([row.metric, row.verdict]).toEqual(['wall-p50', 'ungated']);
    expect(row.note).toContain('the adapter resolved no believable durations');
    expect(row.bandMs).toBe(0);

    const lost = scenario('sol', 'webgpu', dwell(stats(25.2), null));
    expect(compareToPin(pinOf([SOL_GPU]), file([lost])).rows[0].note)
      .toContain('this run resolved none');
    const gained = scenario('earth', 'webgpu', dwell(stats(16.0, { iqrMs: 21 }), stats(15.2)));
    expect(compareToPin(pinOf([EARTH_NO_STREAM]), file([gained])).rows[0].note).toContain('this run does');
  });

  describe('the compute row', () => {
    // A compute dispatch is priced by three's separate compute pool, and the
    // gate exists to fail a PR that makes the frame dearer: every candidate
    // in the cheaper-per-frame wave is a compute dispatch, so a 40 ms compute
    // pass that read as no change was the instrument blind where the
    // programme aims. Its own key, so it is accepted on its own.
    const solCompute = (frame: number, compute: number, computeMs: readonly number[] = [compute]) =>
      scenario('sol', 'webgpu', withCompute(dwell(stats(25.2), stats(frame)), stats(compute), computeMs));
    const SOL_COMPUTE = solCompute(21.8, 1.4);

    it('pins the compute stream and its floor beside the frame, and reads a file without one as null', () => {
      const row = pinOf([solCompute(21.8, 1.4, [1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1])]).rows[0];
      expect(row.compute?.p50).toBe(1.4);
      expect(row.computeFloor).toEqual({ p10: 1.2 });
      expect(pinOf([SOL_GPU]).rows[0].compute).toBeNull();
      expect(pinOf([EARTH_NO_STREAM]).rows[0].compute).toBeNull();
    });

    it('marks a compute move past the floor dearer under its own key, and the frame row separately', () => {
      const diff = compareToPin(pinOf([SOL_COMPUTE]), file([solCompute(21.8, 1.7)]));
      expect(diff.rows.map((r) => [r.key, r.metric, r.verdict])).toEqual([
        ['sol|webgpu', 'gpu-p50', 'same'],
        ['sol|webgpu|compute', 'compute-p10', 'dearer'],
      ]);
      expect(diff.rows[1].bandMs).toBe(computeFloorMs('sol', 1.4));
      expect(pinDiffFails(diff)).toBe(true);
      expect(unacceptedMarks(diff, {})).toEqual(['sol|webgpu|compute']);
      expect(unacceptedMarks(diff, { 'sol|webgpu': { bead: 'b' } })).toEqual(['sol|webgpu|compute']);
      expect(unacceptedMarks(diff, { 'sol|webgpu|compute': { bead: 'b' } })).toEqual([]);
      expect(compareToPin(pinOf([SOL_COMPUTE]), file([solCompute(21.8, 1.5)])).rows[1].verdict).toBe('same');
      expect(compareToPin(pinOf([SOL_COMPUTE]), file([solCompute(21.8, 1.1)])).rows[1].verdict).toBe('cheaper');
    });

    // Both gates read one implementation of the floor, so the tighter cannot
    // certify what the looser rejects. Measured: mw120's compute repeat
    // scatter is 0.009 ms against a pinned 0.289, so 0.06 is a fifth of the
    // pass and six times the noise — and `~` under the inherited constant.
    it('floors the compute band per vantage here too, tightening mw120 to 0.05 ms', () => {
      const tight = { samples: 960, iqrMs: 0.02 };
      const mw120Compute = (compute: number) => scenario('mw120', 'webgpu', withCompute(
        dwell(stats(25.2), stats(19.227, tight)), stats(compute, tight),
      ));
      const diff = compareToPin(pinOf([mw120Compute(0.289)]), file([mw120Compute(0.350)]));
      expect(diff.rows[1].key).toBe('mw120|webgpu|compute');
      expect(diff.rows[1].bandMs).toBe(0.05);
      expect(diff.rows[1].verdict).toBe('dearer');
      expect(diff.rows[0].bandMs).toBe(dwellFloorMs(19.227));
    });

    it('prints the compute row ungated where only one side resolved the stream, naming that side', () => {
      const fromOld = compareToPin(pinOf([SOL_GPU]), file([SOL_COMPUTE])).rows;
      expect(fromOld.map((r) => [r.key, r.verdict])).toEqual([['sol|webgpu', 'same'], ['sol|webgpu|compute', 'ungated']]);
      expect(fromOld[1].note).toContain('the pin carries no compute stream for this row; this run does');
      const lost = compareToPin(pinOf([SOL_COMPUTE]), file([SOL_GPU])).rows[1];
      expect([lost.verdict, lost.note]).toEqual(['ungated', 'the pin carries a compute stream for this row; this run resolved none']);

      // The side with no reading prints empty. A zero there would make the
      // delta column restate `current`, so five untaken rows would read as
      // five ~0.3 ms moves on the table a PR pastes into its Perf section.
      expect([fromOld[1].pinnedMs, fromOld[1].currentMs, fromOld[1].deltaMs]).toEqual([null, 1.4, null]);
      expect([lost.pinnedMs, lost.currentMs, lost.deltaMs]).toEqual([1.4, null, null]);
    });

    it('keeps the frame row on the wall clock it always carries when its stream is one-sided', () => {
      // Only the compute row has no second clock to fall back to; the frame
      // substitutes wall rather than blanking, which is the pre-compute
      // behaviour and what every archived WebGL2 row reads.
      const lostStream = scenario('sol', 'webgpu', dwell(stats(30.1), null));
      const row = compareToPin(pinOf([SOL_GPU]), file([lostStream])).rows[0];
      expect([row.verdict, row.metric]).toEqual(['ungated', 'wall-p50']);
      expect([row.pinnedMs, row.currentMs]).toEqual([25.2, 30.1]);
      expect(row.deltaMs).toBeCloseTo(4.9, 6);
    });

    it('prints no compute row at all where neither side has one', () => {
      expect(compareToPin(pinOf([EARTH_NO_STREAM]), file([EARTH_NO_STREAM])).rows.map((r) => r.key))
        .toEqual(['earth|webgpu']);
      expect(compareToPin(pinOf([SOL_GPU]), file([SOL_GPU])).rows.map((r) => r.key)).toEqual(['sol|webgpu']);
    });

    it('stands the band down on an ungated vantage and keeps the ceiling, exactly as for the frame', () => {
      const lgCompute = (compute: number) => scenario('lg', 'webgpu', withCompute(dwell(stats(16.7), stats(11.891)), stats(compute)));
      const wander = compareToPin(pinOf([lgCompute(1.4)]), file([lgCompute(3)])).rows[1];
      expect([wander.key, wander.verdict]).toEqual(['lg|webgpu|compute', 'ungated']);
      expect(wander.note).toContain(PIN_UNGATED_SCENARIOS.lg);
      const hot = compareToPin(pinOf([lgCompute(1.4)]), file([lgCompute(33.5)])).rows[1];
      expect([hot.verdict, hot.note]).toEqual(['dearer', 'compute-p10 over the 33.4 ms ceiling']);
    });

    it('reads the p10 through a duty-cycle crossing the median marks on', () => {
      const oneMode = Array.from({ length: 100 }, () => 0.39);
      const crossed = [...Array.from({ length: 42 }, () => 0.39), ...Array.from({ length: 58 }, () => 0.61)];
      const earth = (samples: readonly number[], p50: number, p90: number) =>
        scenario('earth', 'webgpu', withCompute(
          dwell(stats(16.7), stats(13.3)), stats(p50, { p90 }), samples,
        ));
      const diff = compareToPin(
        pinOf([earth(oneMode, 0.39, 0.40)]), file([earth(crossed, 0.61, 0.62)]),
      );
      const compute = diff.rows[1]!;
      expect([compute.key, compute.metric, compute.verdict]).toEqual([
        'earth|webgpu|compute', 'compute-p10', 'same',
      ]);
      expect(compute.deltaMs).toBeCloseTo(0, 9);
      expect(compute.bandMs).toBe(computeFloorMs('earth', 0.39));
      expect(0.61 - 0.39).toBeGreaterThan(compute.bandMs);
      // The dear mode is not lost with it: the spread is exactly that gap.
      expect(compute.spreadDeltaMs).toBeCloseTo(0.22, 9);
    });

    it("rides the context's refusals: a refused frame carries no compute row", () => {
      const trended = scenario('sol', 'webgpu', withCompute(dwell(stats(25.2), trending(21.8)), stats(1.4)));
      const diff = compareToPin(pinOf([SOL_COMPUTE]), file([trended]));
      expect(diff.rows).toEqual([]);
      expect(diff.refusals.map((r) => r.key)).toEqual(['sol|webgpu']);
    });
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
    expect(diff.unmeasured).toEqual(['mw120|webgpu', 'earth|webgpu']);
    expect(compareToPin(pinOf([SOL_GPU]), file([resized])).refusals[0].reason).toContain('Mpx');
  });

  // The pin holds no params of its own and is taken with every lever at its
  // default, so this is the pair that would otherwise certify a frame carrying
  // a kernel the pin never measured.
  it('refuses a row taken under a setup lever the pin was not taken under', () => {
    const forced = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)), {
      params: { forceRecompute: true },
    });
    const diff = compareToPin(pinOf(), file([forced]));
    expect(diff.rows).toEqual([]);
    expect(diff.refusals[0].reason).toContain('extinction recompute gated vs forced');
    expect(pinDiffFails(diff)).toBe(true);
  });

  // Tier 1 visits two of the pin's five contexts and answers for those two.
  it('does not fail a run for the pin rows it did not measure', () => {
    const diff = compareToPin(pinOf(), file([SOL_GPU]));
    expect(diff.rows.map((r) => r.key)).toEqual(['sol|webgpu']);
    expect(diff.refusals).toEqual([]);
    expect(diff.unmeasured).toEqual(['mw120|webgpu', 'earth|webgpu']);
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
    const pin = pinOf([MW120_GPU, SOL_GPU, EARTH_NO_STREAM]);
    const tier1 = compareToPin(pin, file([MW120_GPU, SOL_GPU]));
    expect(tier1.refusals).toEqual([]);
    expect(tier1.rows.map((r) => [r.key, r.verdict])).toEqual([['mw120|webgpu', 'same'], ['sol|webgpu', 'same']]);
    expect(tier1.unmeasured).toEqual(['earth|webgpu']);

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
    expect(pinDiffFails(compareToPin(pinOf([EARTH_NO_STREAM]), file([EARTH_NO_STREAM])))).toBe(false);
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
    expect(unacceptedMarks(compareToPin(pinOf([EARTH_NO_STREAM]), file([EARTH_NO_STREAM])), {})).toEqual([]);
  });
});

describe('the pinned dwell length', () => {
  it('is carried on every row, off the params the runner stamped', () => {
    const pin = pinOf([scenario('sol', 'webgpu', dwell(stats(18.7), stats(16.9)), { params: { frames: 960 } })]);
    expect(pin.rows[0].frames).toBe(960);
  });

  // The failure it exists for: a re-take at the runner's default 240 replaces
  // a 960-frame pin, both dwells read steady, and nothing downstream objects.
  it('refuses a run dwelt over a different count', () => {
    const pin = pinOf([scenario('sol', 'webgpu', dwell(stats(18.7), stats(16.9)), { params: { frames: 960 } })]);
    const short = file([scenario('sol', 'webgpu', dwell(stats(18.7), stats(16.9)), { params: { frames: 240 } })]);
    expect(compareToPin(pin, short).refusals[0].reason).toContain('dwell 960 vs 240 frames');
  });

  it('declines the guard against a pin taken before the field existed', () => {
    const pin = pinOf([scenario('sol', 'webgpu', dwell(stats(18.7), stats(16.9)), { params: {} })]);
    expect(pin.rows[0].frames).toBeUndefined();
    const run = file([scenario('sol', 'webgpu', dwell(stats(18.7), stats(16.9)), { params: { frames: 960 } })]);
    expect(compareToPin(pin, run).refusals).toEqual([]);
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

describe('a split-frame frame row bands on its plain class', () => {
  function earthSamples(plainMs: number, plainN: number, dearN: number): number[] {
    return [
      ...Array.from({ length: plainN }, (_, i) => plainMs + (i % 5) * 0.1),
      ...Array.from({ length: dearN }, (_, i) => 74 + (i % 7) * 0.4),
    ];
  }

  const TWO_CLASSES: DwellRecord['passCounts'] = {
    perFrame: { submits: [], commandBuffers: [], renderPasses: [], computePasses: [] },
    summary: {
      submits: { min: 5, p50: 5, max: 14 },
      commandBuffers: { min: 5, p50: 5, max: 14 },
      renderPasses: { min: 4, p50: 4, max: 10 },
      computePasses: { min: 1, p50: 1, max: 1 },
    },
    note: 'counted',
  };

  const earthAt = (samples: readonly number[], passCounts = TWO_CLASSES) => scenario('earth', 'webgpu', {
    ...dwell(stats(16.7), stats(percentileAt(samples, 0.5), {
      samples: samples.length, iqrMs: iqrOf(samples), p90: percentileAt(samples, 0.9),
    })),
    gpuMs: samples,
    passCounts,
  });

  const percentileAt = (xs: readonly number[], p: number): number =>
    [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(p * xs.length) - 1)]!;
  const iqrOf = (xs: readonly number[]): number => percentileAt(xs, 0.75) - percentileAt(xs, 0.25);

  const RESOLVED_HIGH = earthSamples(12.0, 640, 210);
  const RESOLVED_LOW = earthSamples(12.0, 320, 195);

  it('gates the plain class and leaves the mixture unread', () => {
    const diff = compareToPin(pinOf([earthAt(RESOLVED_HIGH)]), file([earthAt(RESOLVED_LOW)]));
    expect(diff.refusals).toEqual([]);
    const frame = diff.rows[0]!;
    expect([frame.key, frame.metric, frame.verdict]).toEqual(['earth|webgpu', 'gpu-plain-p50', 'same']);
    expect(frame.pinnedMs).toBeLessThan(14);
    expect(frame.currentMs).toBeLessThan(14);
  });

  it('bands at the floor where the mixture would have banded far past it', () => {
    const diff = compareToPin(pinOf([earthAt(RESOLVED_HIGH)]), file([earthAt(RESOLVED_LOW)]));
    expect(diff.rows[0]!.bandMs).toBe(dwellFloorMs(diff.rows[0]!.pinnedMs!));
    const mixtureBand = 2 * Math.hypot(
      medianStandardErrorMs({ samples: RESOLVED_HIGH.length, iqrMs: iqrOf(RESOLVED_HIGH) }),
      medianStandardErrorMs({ samples: RESOLVED_LOW.length, iqrMs: iqrOf(RESOLVED_LOW) }),
    );
    expect(mixtureBand).toBeGreaterThan(10 * diff.rows[0]!.bandMs);
  });

  it('records both classes, so the dear one keeps a reading of its own', () => {
    const classes = pinOf([earthAt(RESOLVED_HIGH)]).rows[0]!.gpuClasses!;
    expect(classes.plain.samples).toBe(640);
    expect(classes.dear.samples).toBe(210);
    expect(classes.dear.p50).toBeGreaterThan(74);
    expect(classes.cutMs).toBeGreaterThan(13);
    expect(classes.cutMs).toBeLessThan(74);
    expect(pinOf([SOL_GPU]).rows[0]!.gpuClasses).toBeNull();
  });

  it('takes no cut where the counters read one class, however wide the gap', () => {
    const wandering = [...Array.from({ length: 40 }, () => 10.2), ...Array.from({ length: 10 }, () => 31.0)];
    const flat: DwellRecord['passCounts'] = {
      ...TWO_CLASSES,
      summary: { ...TWO_CLASSES!.summary, renderPasses: { min: 4, p50: 4, max: 4 } },
    };
    expect(pinOf([earthAt(wandering, flat)]).rows[0]!.gpuClasses).toBeNull();
    expect(compareToPin(pinOf([earthAt(wandering, flat)]), file([earthAt(wandering, flat)])).rows[0]!.metric)
      .toBe('gpu-p50');
  });

  it('falls back to the mixture where the pin holds no classes', () => {
    const pin = pinOf([earthAt(RESOLVED_HIGH)]);
    const older: PinFile = { ...pin, rows: pin.rows.map(({ gpuClasses, ...rest }) => rest) };
    const frame = compareToPin(older, file([earthAt(RESOLVED_LOW)])).rows[0]!;
    expect(frame.metric).toBe('gpu-p50');
  });

  it('names a band its own spread set rather than its floor', () => {
    const pin = pinOf([earthAt(RESOLVED_HIGH)]);
    const older: PinFile = { ...pin, rows: pin.rows.map(({ gpuClasses, ...rest }) => rest) };
    const frame = compareToPin(older, file([earthAt(RESOLVED_LOW)])).rows[0]!;
    expect(frame.bandMs).toBeGreaterThan(BAND_OVER_FLOOR_FACTOR * dwellFloorMs(frame.pinnedMs!));
    expect(frame.note).toContain("the row's own spread sets it, not the floor");
  });
});
