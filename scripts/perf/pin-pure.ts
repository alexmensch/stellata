// The perf pin: a committed summary of the whole frame at the canon vantages
// on one GPU, and the verdicts of a later run against it. Operator rules:
// RELEASING.md § Perf pin; mechanics: pins/README.md.

import { basename, relative, resolve } from 'node:path';
import { medianStandardErrorMs } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { BUFFER_MPX_TOLERANCE, VERDICT_MARK, band, type DiffRefusal, type Verdict } from './diff-pure';
import type { StateGuard } from './dwell-pure';
import { DWELL_METHOD } from './run-pure';
import type { AdapterProbe, DwellRecord, PerfFile, ScenarioRecord } from './schema';
import type { Backend, ScenarioName } from './scenarios';

/** Removing a field or changing what one MEANS bumps the suffix; adding one
 *  does not — the same contract as `PERF_SCHEMA`. */
export const PIN_SCHEMA = 'stellata-perf/pin-1';

/** A row moves only past the pair's two-sigma band AND past this floor,
 *  whichever of the two forms is larger. Both derived from the cold-to-cold
 *  spread of two pins on identical code: pins/README.md § Reading
 *  `--against-pin`. */
export const PIN_FLOOR_MS = 0.25;
export const PIN_FLOOR_FRACTION = 0.01;

/** Vantages the pin records but never marks, because they do not reproduce
 *  cold-to-cold. lg shifts level BETWEEN runs while staying flat inside each,
 *  which is exactly what the state guard cannot catch — so a steady verdict
 *  on an lg row is not evidence it is comparable. pins/README.md § Reading
 *  `--against-pin`. */
export const PIN_UNGATED_SCENARIOS: readonly ScenarioName[] = ['lg'];

/** Two 60 Hz intervals of hardware time. A canon vantage whose GPU-stream
 *  p50 crosses it marks whatever the band says. */
export const PIN_CEILING_MS = 33.4;

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

/** Which clock the row's numbers came from. `wall-p50` appears only on an
 *  ungated row, where it is context rather than a reading the gate acts on;
 *  an ungated row may equally carry `gpu-p50` as context. */
export type PinMetric = 'gpu-p50' | 'wall-p50';

/** `ungated` is a row the pin records but never marks, on either of two
 *  grounds: it carries no GPU-stream median on one side or the other, and
 *  wall time is quantised to the display's refresh interval; or its vantage
 *  is in `PIN_UNGATED_SCENARIOS`. RELEASING.md § Perf pin. */
export type PinVerdict = Verdict | 'ungated';

export const PIN_VERDICT_MARK: Record<PinVerdict, string> = { ...VERDICT_MARK, ungated: '·' };

export interface PinVerdictRow {
  readonly key: string;
  readonly metric: PinMetric;
  readonly pinnedMs: number;
  readonly currentMs: number;
  readonly deltaMs: number;
  readonly bandMs: number;
  readonly verdict: PinVerdict;
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

/**
 * How the pin cites the run it was summarised from. Runs are filed under
 * `.perf-runs/<date>/` in the main checkout (README.md § Recording), so that
 * is the path worth committing: an absolute one names one machine's home
 * directory, resolves nowhere else, and this file ships in a public repo.
 * A run stored outside the checkout keeps its name and loses its location.
 */
export function citeRunPath(jsonPath: string, mainCheckout: string): string {
  const rel = relative(mainCheckout, resolve(jsonPath));
  return rel === '' || rel.startsWith('..') ? basename(jsonPath) : rel;
}

export function pinFloorMs(pinnedMs: number): number {
  return Math.max(PIN_FLOOR_MS, PIN_FLOOR_FRACTION * pinnedMs);
}

function verdictFor(deltaMs: number, bandMs: number): Verdict {
  if (Math.abs(deltaMs) <= bandMs) return 'same';
  return deltaMs < 0 ? 'cheaper' : 'dearer';
}

/** Which side is missing the GPU stream, so an ungated row says why rather
 *  than only that it is ungated — the pin having one and the run not is an
 *  instrument regression, not the WebGL2 backend being itself. */
function ungatedNote(pinned: PinRow, current: PinClock | null): string {
  if (pinned.gpu === null && current === null) {
    return pinned.backend === 'webgl2'
      ? 'no GPU stream — WebGL2 supplies none'
      : 'no GPU stream on either side — the adapter resolved no believable durations';
  }
  return pinned.gpu === null
    ? 'the pin carries no GPU stream for this row; this run does'
    : 'the pin carries a GPU stream for this row; this run resolved none';
}

function compareRow(pinned: PinRow, record: ScenarioRecord): PinVerdictRow {
  const dwell = record.dwell!;
  const base = { key: pinned.key };

  if (pinned.gpu === null || dwell.gpuStats === null) {
    return {
      ...base,
      metric: 'wall-p50',
      pinnedMs: pinned.wall.p50,
      currentMs: dwell.stats.p50,
      deltaMs: dwell.stats.p50 - pinned.wall.p50,
      bandMs: 0,
      verdict: 'ungated',
      note: ungatedNote(pinned, dwell.gpuStats),
    };
  }

  if (PIN_UNGATED_SCENARIOS.includes(pinned.name)) {
    return {
      ...base,
      metric: 'gpu-p50',
      pinnedMs: pinned.gpu.p50,
      currentMs: dwell.gpuStats.p50,
      deltaMs: dwell.gpuStats.p50 - pinned.gpu.p50,
      bandMs: 0,
      verdict: 'ungated',
      note: `${pinned.name} does not reproduce cold-to-cold — recorded, never marked`,
    };
  }

  const deltaMs = dwell.gpuStats.p50 - pinned.gpu.p50;
  const bandMs = band(
    medianStandardErrorMs(pinned.gpu), medianStandardErrorMs(dwell.gpuStats), pinFloorMs(pinned.gpu.p50),
  );
  const row: PinVerdictRow = {
    ...base, metric: 'gpu-p50', pinnedMs: pinned.gpu.p50, currentMs: dwell.gpuStats.p50,
    deltaMs, bandMs, verdict: verdictFor(deltaMs, bandMs), note: '',
  };
  if (dwell.gpuStats.p50 > PIN_CEILING_MS) {
    return { ...row, verdict: 'dearer', note: `GPU-stream p50 over the ${PIN_CEILING_MS} ms ceiling` };
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

/**
 * Whether a comparison fails the run. A per-row refusal counts: a run whose
 * rows were every one refused — all trending, all resized — would otherwise
 * print a table with no `✗` in it and exit 0, which reads as a pass.
 */
export function pinDiffFails(diff: PinDiff): boolean {
  return diff.refusedWholeRun !== null
    || diff.refusals.length > 0
    || diff.rows.some((row) => row.verdict === 'dearer');
}

/**
 * The marked rows no `--accept` covers. Writing a pin over one of those is
 * the ratchet RELEASING.md § Perf pin names: an unexamined regression
 * becomes the pinned value, and the frame walks upward a PR at a time with
 * only the ceiling ever catching it.
 */
export function unacceptedMarks(
  diff: PinDiff,
  accepted: Readonly<Record<string, PinAcceptance>>,
): string[] {
  return diff.rows
    .filter((row) => row.verdict === 'dearer' && accepted[row.key] === undefined)
    .map((row) => row.key);
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
