// The perf pin: a committed summary of the whole frame at the canon vantages
// on one GPU, and the verdicts of a later run against it. Operator rules:
// RELEASING.md § Perf pin; mechanics: README.md § Pinning.

import { medianStandardErrorMs } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { BUFFER_MPX_TOLERANCE, band, type DiffRefusal, type Verdict } from './diff-pure';
import type { StateGuard } from './dwell-pure';
import { DWELL_METHOD } from './run-pure';
import type { AdapterProbe, DwellRecord, PerfFile, ScenarioRecord } from './schema';
import type { Backend, ScenarioName } from './scenarios';

/** Removing a field or changing what one MEANS bumps the suffix; adding one
 *  does not — the same contract as `PERF_SCHEMA`. */
export const PIN_SCHEMA = 'stellata-perf-pin/1';

/** A row moves only past the pair's two-sigma band AND past this floor,
 *  whichever of the two forms is larger: cold GPU-stream medians reproduce
 *  to about 1 % run to run, so 3 % is three times that, and 0.5 ms is the
 *  absolute floor under which the wall clock resolves nothing. */
export const PIN_FLOOR_MS = 0.5;
export const PIN_FLOOR_FRACTION = 0.03;

/** Two 60 Hz intervals. A canon vantage over it on the pinned backend
 *  marks whatever the band says. */
export const PIN_CEILING_MS = 33.4;
export const PIN_CEILING_BACKEND: Backend = 'webgpu';

export class PinError extends Error {}

export interface PinClock {
  readonly p50: number;
  readonly p90: number;
  readonly iqrMs: number;
  readonly samples: number;
  readonly stateGuard: StateGuard;
}

export interface PinRow {
  /** `scenario|backend`, the key `--baseline` uses too. */
  readonly key: string;
  readonly name: ScenarioName;
  readonly backend: Backend;
  readonly bufferMpx: number;
  readonly idleRafMs: number | null;
  readonly method: string;
  readonly wall: PinClock & { readonly vsyncClamped: boolean };
  /** The WebGPU frame-sample stream where it was sound; null on WebGL2. */
  readonly gpu: PinClock | null;
}

export interface PinAcceptance {
  readonly bead: string;
}

export interface PinFile {
  readonly schema: typeof PIN_SCHEMA;
  readonly adapterSlug: string;
  readonly adapter: AdapterProbe;
  readonly git: PerfFile['run']['git'];
  readonly version: string;
  readonly takenAt: string;
  /** The run file the rows were summarised from, under `.perf-runs/`. */
  readonly sourceRun: string;
  readonly rows: readonly PinRow[];
  /** Rows whose mark was accepted when this pin was taken, keyed like the
   *  rows: provenance for the value now pinned, never a filter on marks. */
  readonly accepted: Readonly<Record<string, PinAcceptance>>;
}

export type PinMetric = 'gpu-p50' | 'wall-p50' | 'cadence';

export interface PinVerdictRow {
  readonly key: string;
  readonly metric: PinMetric;
  readonly pinnedMs: number;
  readonly currentMs: number;
  readonly deltaMs: number;
  readonly bandMs: number;
  readonly verdict: Verdict;
  readonly note: string;
}

export interface PinDiff {
  readonly refusedWholeRun: string | null;
  readonly rows: readonly PinVerdictRow[];
  readonly refusals: readonly DiffRefusal[];
}

const ANGLE_METAL_MODEL = /ANGLE \([^,]+, ANGLE Metal Renderer: ([^,]+),/;

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * One GPU, one slug. The WebGL renderer string names the chip (`Apple M4`
 * inside ANGLE's Metal wrapper), the WebGPU probe names the architecture
 * (`metal-3`); the two together are what a frame time is a property of.
 * Null when the run carried no probe at all.
 */
export function adapterSlug(probe: AdapterProbe | null): string | null {
  if (probe === null || (probe.webgl === null && probe.webgpu === null)) return null;
  const parts: string[] = [];
  if (probe.webgl !== null) {
    const model = ANGLE_METAL_MODEL.exec(probe.webgl.renderer)?.[1] ?? probe.webgl.renderer;
    parts.push(slugify(model));
  }
  if (probe.webgpu !== null) {
    if (probe.webgl === null) parts.push(slugify(probe.webgpu.vendor));
    if (probe.webgpu.architecture !== '') parts.push(slugify(probe.webgpu.architecture));
  }
  return parts.filter((p) => p.length > 0).join('-');
}

export function pinKey(record: ScenarioRecord): string {
  return `${record.name}|${record.backend.actual ?? 'unbooted'}`;
}

function clockOf(stats: DwellRecord['stats']): PinClock {
  return {
    p50: stats.p50,
    p90: stats.p90,
    iqrMs: stats.iqrMs,
    samples: stats.samples,
    stateGuard: stats.stateGuard,
  };
}

/** Why a scenario record cannot be a pin row, or compared against one. */
function rowRefusal(record: ScenarioRecord): string | null {
  if (record.failed || record.tainted) return 'the scenario failed or was tainted';
  if (record.mode !== 'dwell' || record.dwell === null) return `mode ${record.mode} — a pin is dwell-mode whole-frame medians`;
  if (record.dwellAfter !== null) return 'a round-trip run is not a pin';
  if (record.method !== DWELL_METHOD) return `method ${record.method ?? 'none'} — a pin is ${DWELL_METHOD}`;
  if (record.bufferMpx === null) return 'no drawing buffer recorded';
  if (record.backend.actual === null) return 'the backend never booted';
  const trending = record.dwell.stats.stateGuard === 'trending'
    || record.dwell.gpuStats?.stateGuard === 'trending';
  if (trending) return 'the dwell trended across its quarters — it straddled a load-state transition';
  return null;
}

export interface PinSource {
  readonly sourceRun: string;
  readonly version: string;
  readonly accepted: Readonly<Record<string, PinAcceptance>>;
}

/**
 * Summarise a dwell-mode run as a pin, or say why not. Any refused
 * scenario refuses the whole pin: a pin missing a row would narrow the
 * gate silently, and a run taken headed or on a software adapter is not
 * the machine the pin describes.
 */
export function pinFromRun(file: PerfFile, source: PinSource): { pin: PinFile | null; refusals: readonly string[] } {
  const refusals: string[] = [];
  const slug = adapterSlug(file.run.gpu);
  if (slug === null) refusals.push('the run carried no adapter probe');
  if (!file.run.browser.headless) refusals.push('a headed run — headed and headless never compare');
  if (file.scenarios.length === 0) refusals.push('the run measured nothing');
  const rows: PinRow[] = [];
  for (const record of file.scenarios) {
    const why = rowRefusal(record);
    if (why !== null) {
      refusals.push(`${pinKey(record)}: ${why}`);
      continue;
    }
    const dwell = record.dwell!;
    rows.push({
      key: pinKey(record),
      name: record.name,
      backend: record.backend.actual!,
      bufferMpx: record.bufferMpx!,
      idleRafMs: record.idleRafMs,
      method: record.method!,
      wall: { ...clockOf(dwell.stats), vsyncClamped: dwell.stats.vsyncClamped },
      gpu: dwell.gpuStats === null ? null : clockOf(dwell.gpuStats),
    });
  }
  if (refusals.length > 0 || slug === null || file.run.gpu === null) return { pin: null, refusals };
  return {
    pin: {
      schema: PIN_SCHEMA,
      adapterSlug: slug,
      adapter: file.run.gpu,
      git: file.run.git,
      version: source.version,
      takenAt: file.run.finishedAt,
      sourceRun: source.sourceRun,
      rows,
      accepted: source.accepted,
    },
    refusals,
  };
}

export function pinFloorMs(pinnedMs: number): number {
  return Math.max(PIN_FLOOR_MS, PIN_FLOOR_FRACTION * pinnedMs);
}

function verdictFor(deltaMs: number, bandMs: number): Verdict {
  if (Math.abs(deltaMs) <= bandMs) return 'same';
  return deltaMs < 0 ? 'cheaper' : 'dearer';
}

function compareRow(pinned: PinRow, record: ScenarioRecord): PinVerdictRow {
  const dwell = record.dwell!;
  const wall = dwell.stats;
  const base = { key: pinned.key, bandMs: 0 };

  if (pinned.wall.vsyncClamped !== wall.vsyncClamped) {
    const left = pinned.wall.vsyncClamped;
    return {
      ...base,
      metric: 'cadence',
      pinnedMs: pinned.wall.p50,
      currentMs: wall.p50,
      deltaMs: wall.p50 - pinned.wall.p50,
      verdict: left ? 'dearer' : 'cheaper',
      note: left ? 'left the display cadence' : 'onto the display cadence',
    };
  }

  let row: PinVerdictRow;
  if (pinned.gpu !== null && dwell.gpuStats !== null) {
    const deltaMs = dwell.gpuStats.p50 - pinned.gpu.p50;
    const bandMs = band(
      medianStandardErrorMs(pinned.gpu), medianStandardErrorMs(dwell.gpuStats), pinFloorMs(pinned.gpu.p50),
    );
    row = {
      ...base, metric: 'gpu-p50', pinnedMs: pinned.gpu.p50, currentMs: dwell.gpuStats.p50,
      deltaMs, bandMs, verdict: verdictFor(deltaMs, bandMs), note: '',
    };
  } else if (pinned.wall.vsyncClamped) {
    row = {
      ...base, metric: 'cadence', pinnedMs: pinned.wall.p50, currentMs: wall.p50,
      deltaMs: wall.p50 - pinned.wall.p50, verdict: 'same', note: 'still on the display cadence',
    };
  } else {
    const deltaMs = wall.p50 - pinned.wall.p50;
    const bandMs = band(
      medianStandardErrorMs(pinned.wall), medianStandardErrorMs(wall), pinFloorMs(pinned.wall.p50),
    );
    row = {
      ...base, metric: 'wall-p50', pinnedMs: pinned.wall.p50, currentMs: wall.p50,
      deltaMs, bandMs, verdict: verdictFor(deltaMs, bandMs), note: '',
    };
  }

  if (pinned.backend === PIN_CEILING_BACKEND && wall.p50 > PIN_CEILING_MS) {
    return { ...row, verdict: 'dearer', note: `wall p50 over the ${PIN_CEILING_MS} ms ceiling` };
  }
  return row;
}

/**
 * A run against the pin. The refusals are the point as much as the rows:
 * a different GPU, a headed run, a resized buffer or a context that
 * straddled the load transition produce a table that looks like a
 * comparison and is not.
 */
export function compareToPin(pin: PinFile, current: PerfFile): PinDiff {
  const slug = adapterSlug(current.run.gpu);
  if (slug !== pin.adapterSlug) {
    return {
      refusedWholeRun: `adapter '${slug ?? 'none'}' vs pin '${pin.adapterSlug}' — a frame time is a property of the GPU that drew it`,
      rows: [],
      refusals: [],
    };
  }
  if (!current.run.browser.headless) {
    return { refusedWholeRun: 'a headed run — the pin is headless, and the two never compare', rows: [], refusals: [] };
  }
  const rows: PinVerdictRow[] = [];
  const refusals: DiffRefusal[] = [];
  const byKey = new Map(current.scenarios.map((s) => [pinKey(s), s]));
  for (const pinned of pin.rows) {
    const record = byKey.get(pinned.key);
    if (record === undefined) {
      refusals.push({ key: pinned.key, reason: 'not measured in this run' });
      continue;
    }
    const why = rowRefusal(record);
    if (why !== null) {
      refusals.push({ key: pinned.key, reason: why });
      continue;
    }
    const drift = Math.abs(record.bufferMpx! - pinned.bufferMpx) / pinned.bufferMpx;
    if (drift > BUFFER_MPX_TOLERANCE) {
      refusals.push({
        key: pinned.key,
        reason: `buffer ${pinned.bufferMpx} vs ${record.bufferMpx} Mpx (${(drift * 100).toFixed(1)} % apart)`,
      });
      continue;
    }
    rows.push(compareRow(pinned, record));
  }
  return { refusedWholeRun: null, rows, refusals };
}

export function assertPinFile(value: unknown, source: string): PinFile {
  if (typeof value !== 'object' || value === null) {
    throw new PinError(`${source} is not a perf pin (expected an object)`);
  }
  const schema = (value as { schema?: unknown }).schema;
  if (schema !== PIN_SCHEMA) {
    throw new PinError(
      `${source} carries schema ${JSON.stringify(schema)}, not '${PIN_SCHEMA}' — ` +
      'refusing to read it as a pin rather than mapping fields whose meaning may have changed',
    );
  }
  const pin = value as Partial<PinFile>;
  if (typeof pin.adapterSlug !== 'string' || !Array.isArray(pin.rows)) {
    throw new PinError(`${source} has no adapter slug or no rows`);
  }
  return pin as PinFile;
}

/** `scripts/perf/pins/<slug>.json`, relative to the repo root. */
export function pinPathFor(slug: string): string {
  return `scripts/perf/pins/${slug}.json`;
}
