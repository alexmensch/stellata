import { describe, expect, it } from 'vitest';
import { BUFFER_MPX_TOLERANCE } from './diff-pure';
import type { DwellSummary } from './dwell-pure';
import {
  PIN_CEILING_MS,
  PIN_FLOOR_FRACTION,
  PIN_FLOOR_MS,
  PIN_SCHEMA,
  PinError,
  adapterSlug,
  assertPinFile,
  citeRunPath,
  compareToPin,
  pinDiffFails,
  pinFloorMs,
  pinFromRun,
  pinPathFor,
  unacceptedMarks,
  type PinFile,
} from './pin-pure';
import { PERF_SCHEMA, type AdapterProbe, type DwellRecord, type PerfFile, type ScenarioRecord } from './schema';
import type { Backend, ScenarioName } from './scenarios';

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

/** iqr 1.349 over 240 samples: the median's standard error is 0.0809 ms, so
 *  a two-sigma band on a pair is 0.229 — always under the pin floor. */
function stats(p50: number, overrides: Partial<DwellSummary> = {}): DwellSummary {
  return {
    samples: 240, p50, p90: p50 + 2, p99: p50 + 5, iqrMs: 1.349, lag1: 0,
    vsyncClamped: false, quarterMedians: [p50, p50, p50, p50], stateGuard: 'steady',
    ...overrides,
  };
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
    buffer: { width: 2560, height: 1600 }, bufferMpx: 4.096,
    mode: 'dwell', method: 'raf-delta', params: {}, settleMs: 5000, idleRafMs: 16.7,
    differential: null, dwell: record, dwellAfter: null, roundtrip: null, sweep: null,
    console: [], pageErrors: [], tainted: false, failed: false, failure: null,
    ...overrides,
  };
}

function file(scenarios: readonly ScenarioRecord[], overrides: { gpu?: AdapterProbe | null; headless?: boolean } = {}): PerfFile {
  return {
    schema: PERF_SCHEMA,
    run: {
      startedAt: '2026-09-05T20:00:00.000Z', finishedAt: '2026-09-05T20:03:00.000Z',
      url: 'http://localhost:5173', argv: [], git: { commit: 'abc1234', dirty: false },
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
const SOURCE = { sourceRun: '.perf-runs/2026-09-05/pin.json', version: '3.44.3', accepted: {} };

function pinOf(scenarios: readonly ScenarioRecord[] = [SOL_GPU, MW120_GPU, SOL_GL]): PinFile {
  const { pin, refusals } = pinFromRun(file(scenarios), SOURCE);
  expect(refusals).toEqual([]);
  return pin!;
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

describe('pinFromRun', () => {
  it('summarises every dwell row, GPU stream where sound, and carries the provenance', () => {
    const { pin } = pinFromRun(file([SOL_GPU, MW120_GPU, SOL_GL]), { ...SOURCE, accepted: { 'sol|webgpu': { bead: 'bead-1' } } });
    expect(pin!.schema).toBe(PIN_SCHEMA);
    expect(pin!.adapterSlug).toBe('apple-m4-metal-3');
    expect(pin!.version).toBe('3.44.3');
    expect(pin!.takenAt).toBe('2026-09-05T20:03:00.000Z');
    expect(pin!.sourceRun).toBe(SOURCE.sourceRun);
    expect(pin!.accepted['sol|webgpu'].bead).toBe('bead-1');
    expect(pin!.rows.map((r) => r.key)).toEqual(['sol|webgpu', 'mw120|webgpu', 'sol|webgl2']);
    expect(pin!.rows[0].gpu!.p50).toBe(21.8);
    expect(pin!.rows[1].wall.vsyncClamped).toBe(true);
    expect(pin!.rows[2].gpu).toBeNull();
    expect(pin!.rows[2].method).toBe('raf-delta');
  });

  it('refuses the whole pin on any row it cannot stand behind', () => {
    const refused = (s: ScenarioRecord) => pinFromRun(file([SOL_GPU, s]), SOURCE);
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { failed: true })).pin).toBeNull();
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { mode: 'differential', dwell: null })).refusals[0])
      .toContain('dwell-mode');
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { method: 'timestamp' })).refusals[0])
      .toContain('raf-delta');
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7, { quarterMedians: [17.4, 18.2, 19.6, 21], stateGuard: 'trending' }), stats(16.9)))).refusals[0])
      .toContain('load-state transition');
    expect(refused(scenario('earth', 'webgpu', dwell(stats(18.7), stats(16.9)), { dwellAfter: dwell(stats(18.7), stats(16.9)) })).refusals[0])
      .toContain('round-trip');
  });

  it('refuses a headed run, a run without a probe, and an empty run', () => {
    expect(pinFromRun(file([SOL_GPU], { headless: false }), SOURCE).refusals[0]).toContain('headed');
    expect(pinFromRun(file([SOL_GPU], { gpu: null }), SOURCE).refusals[0]).toContain('adapter probe');
    expect(pinFromRun(file([]), SOURCE).pin).toBeNull();
  });
});

describe('compareToPin', () => {
  it('pins the floor at 0.5 ms or 3 %, whichever is larger', () => {
    expect(PIN_FLOOR_MS).toBe(0.5);
    expect(PIN_FLOOR_FRACTION).toBe(0.03);
    expect(pinFloorMs(10)).toBe(0.5);
    expect(pinFloorMs(25)).toBe(0.75);
  });

  it('calls a run against its own pin unchanged, on the GPU stream where the pin has one', () => {
    const diff = compareToPin(pinOf(), file([SOL_GPU, MW120_GPU, SOL_GL]));
    expect(diff.refusedWholeRun).toBeNull();
    expect(diff.refusals).toEqual([]);
    expect(diff.rows.map((r) => [r.key, r.metric, r.verdict])).toEqual([
      ['sol|webgpu', 'gpu-p50', 'same'],
      ['mw120|webgpu', 'gpu-p50', 'same'],
      ['sol|webgl2', 'wall-p50', 'ungated'],
    ]);
    expect(diff.rows[0].bandMs).toBe(pinFloorMs(21.8));
    expect(pinDiffFails(diff)).toBe(false);
  });

  it('marks a GPU-stream move past the floor dearer, and one inside it not at all', () => {
    const dearer = scenario('sol', 'webgpu', dwell(stats(25.2), stats(22.6)));
    const inside = scenario('sol', 'webgpu', dwell(stats(25.2), stats(22.4)));
    expect(compareToPin(pinOf([SOL_GPU]), file([dearer])).rows[0].verdict).toBe('dearer');
    expect(compareToPin(pinOf([SOL_GPU]), file([inside])).rows[0].verdict).toBe('same');
    const cheaper = scenario('sol', 'webgpu', dwell(stats(25.2), stats(20.9)));
    expect(compareToPin(pinOf([SOL_GPU]), file([cheaper])).rows[0].verdict).toBe('cheaper');
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

  it('refuses a row that is missing, trended, or was measured at another buffer', () => {
    const trended = scenario('sol', 'webgpu', dwell(stats(25.2, { quarterMedians: [24, 25, 26, 27], stateGuard: 'trending' }), stats(21.8)));
    const resized = scenario('sol', 'webgpu', dwell(stats(25.2), stats(21.8)), { bufferMpx: 4.096 * (1 + 2 * BUFFER_MPX_TOLERANCE) });
    const diff = compareToPin(pinOf(), file([trended]));
    expect(diff.rows).toEqual([]);
    expect(diff.refusals.map((r) => r.key)).toEqual(['sol|webgpu', 'mw120|webgpu', 'sol|webgl2']);
    expect(diff.refusals[0].reason).toContain('load-state transition');
    expect(diff.refusals[1].reason).toBe('not measured in this run');
    expect(compareToPin(pinOf([SOL_GPU]), file([resized])).refusals[0].reason).toContain('Mpx');
  });
});

describe('pinDiffFails — a refused comparison is not a pass', () => {
  it('fails on a ✗ row, on a whole-run refusal, and on a per-row refusal', () => {
    const dearer = scenario('sol', 'webgpu', dwell(stats(25.2), stats(22.6)));
    expect(pinDiffFails(compareToPin(pinOf([SOL_GPU]), file([dearer])))).toBe(true);
    expect(pinDiffFails(compareToPin(pinOf(), file([SOL_GPU], { headless: false })))).toBe(true);

    // Every row refused prints a table with no ✗ in it, which would read as
    // a clean run if only the marks were counted.
    const trended = scenario('sol', 'webgpu', dwell(stats(25.2, { quarterMedians: [24, 25, 26, 27], stateGuard: 'trending' }), stats(21.8)));
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
    expect(unacceptedMarks(diff, { 'sol|webgpu': { bead: 'stellata-8cg.49.12' } })).toEqual([]);
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
