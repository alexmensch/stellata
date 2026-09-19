// The perf pin: a committed summary of the whole frame at the canon vantages
// on one GPU, and the verdicts of a later run against it. Operator rules:
// RELEASING.md § Perf pin; mechanics: pins/README.md.

import { basename, relative, resolve } from 'node:path';
import { medianStandardErrorMs } from '../../src/client/debug/frame-cost/frame-cost-pure';
import {
  VERDICT_MARK, band, bufferRefusal, dwellFloorMs, dwellFrames, framesRefusal, positionRefusal,
  preconditionRefusal, readbackRefusal, recordCountRefusal, splitFrameClasses, verdictFor,
  type DiffRefusal, type Verdict,
} from './diff/diff-pure';
import {
  COMPUTE_ROW, computeClock, floorMove, frameFloor, gatingClock,
  type DwellMetric, type DwellSummary, type FrameFloor, type StateGuard,
} from './dwell/dwell-pure';
import { DWELL_METHOD, contextOrder } from './run-pure';
import { PERF_SCHEMA, type AdapterProbe, type DwellRecord, type GitProvenance, type PerfFile, type ScenarioRecord } from './schema';
import { BACKENDS, SCENARIO_NAMES, type Backend, type ScenarioName } from './scenarios';

/** Removing a field or changing what one MEANS bumps the suffix; adding one
 *  does not — the same contract as `PERF_SCHEMA`. */
export const PIN_SCHEMA = 'stellata-perf/pin-3';

/** Vantages the band never marks, mapped to the reason, which the row's note
 *  carries. lg wanders as much across one dwell's quarters as it does between
 *  runs, so neither a steady nor a trending state guard says anything about
 *  whether the row is comparable — and a trending one must therefore not
 *  refuse it, since any refused row refuses the whole pin. The ceiling still
 *  applies: a vantage that wanders 1.5 ms is no licence for a frame that
 *  doubled. pins/README.md § Reading `--against-pin`. */
export const PIN_UNGATED_SCENARIOS: Readonly<Partial<Record<ScenarioName, string>>> = {
  lg: 'wanders as much inside one dwell as between runs',
};

/** Two 60 Hz intervals of hardware time. A canon vantage whose GPU-stream
 *  p50 crosses it marks whatever the band says, and whether or not the
 *  vantage is gated — it is the backstop on every row carrying a GPU
 *  reading, which is what makes it the one bound accepted marks cannot
 *  ratchet past. */
export const PIN_CEILING_MS = 33.4;

/** A ✗ whose floor rose by less than this share of the median's rise lifted
 *  only its upper half — the wander shape, not a per-frame cost, which lifts
 *  the whole distribution. The row's note says so; the verdict stands. */
export const FLOOR_FOLLOWS_FRACTION = 0.25;

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
  /** The scene the row priced: star records the page had loaded. */
  readonly recordCount: number;
  /** Where the context sat in the pin run, 1-based; a row compares only
   *  against one taken at the same position (`./diff/diff-pure.ts`). */
  readonly position: number;
  readonly idleRafMs: number | null;
  /** Exposure readbacks per frame over the dwell. Where the vantage draws a
   *  readback frame and a plain one, the GPU-stream median follows this rate,
   *  so a row taken at another one is not the same statistic (`./diff/diff-pure.ts`).
   *  Absent on a pin taken before the rate was summarised, which declines the
   *  guard rather than refusing the row. */
  readonly readbackPerFrame?: number;
  /** Whether the pinned dwell drew two classes of frame. Carried because the
   *  pin holds no pass counters of its own, and the guard above must turn on
   *  where EITHER side is split: the duty cycle erases its own evidence as it
   *  approaches 1, every frame becoming a readback frame and the counters
   *  reading flat, so a run alone cannot answer it. Absent on a pin taken
   *  before the field existed, which reads as the run's own verdict. */
  readonly splitFrame?: boolean;
  /** Frames the pinned dwell timed. A row compares only against one taken
   *  over the same count: a median converges with dwell length, so two
   *  lengths are two statistics rather than two readings
   *  (`./diff/diff-pure.ts`). Absent on a pin taken before the field
   *  existed, which declines the guard rather than refusing the row. */
  readonly frames?: number;
  readonly method: string;
  readonly wall: PinClock & { readonly vsyncClamped: boolean };
  /** The WebGPU frame-sample stream where it was sound; null on WebGL2. */
  readonly gpu: PinClock | null;
  readonly gpuFloor: FrameFloor | null;
  /** The compute-pass stream beside it — its own row, never folded into
   *  `gpu`, so every row taken before it existed stays comparable. Absent on
   *  such a pin, which prints the compute row ungated rather than refusing
   *  the context. */
  readonly compute?: PinClock | null;
  readonly computeFloor?: FrameFloor | null;
  /** The run file this row was summarised from, under `.perf-runs/`. Rows
   *  of one pin may cite different runs of the same commit (`pinFromRuns`). */
  readonly sourceRun: string;
}

export interface PinAcceptance {
  readonly bead: string;
}

/** Parsed `--accept` marks as the pin records them, keyed like the rows. */
export function acceptedMarks(
  marks: readonly (PinAcceptance & { readonly key: string })[],
): Record<string, PinAcceptance> {
  return Object.fromEntries(marks.map(({ key, bead }) => [key, { bead }]));
}

export interface PinFile {
  readonly schema: typeof PIN_SCHEMA;
  readonly adapterSlug: string;
  readonly adapter: AdapterProbe;
  readonly git: GitProvenance;
  readonly version: string;
  readonly takenAt: string;
  /** Every run file the rows were drawn from, oldest first. */
  readonly sourceRuns: readonly string[];
  readonly rows: readonly PinRow[];
  /** Rows whose mark was accepted when this pin was taken, keyed like the
   *  rows: provenance for the value now pinned, never a filter on marks. */
  readonly accepted: Readonly<Record<string, PinAcceptance>>;
}

/** `ungated` is a row the band never marks, on either of two grounds: it
 *  carries no GPU-stream median on one side or the other, and wall time is
 *  quantised to the display's refresh interval; or its vantage is in
 *  `PIN_UNGATED_SCENARIOS`. The ceiling reaches the second kind, so an
 *  ungated vantage can still read `dearer`. RELEASING.md § Perf pin. */
export type PinVerdict = Verdict | 'ungated';

export const PIN_VERDICT_MARK: Record<PinVerdict, string> = { ...VERDICT_MARK, ungated: '·' };

export interface PinVerdictRow {
  readonly key: string;
  /** `wall-p50` appears only on an ungated row, where it is context rather
   *  than a reading the gate acts on; an ungated row may equally carry
   *  `gpu-p50` as context. */
  readonly metric: DwellMetric;
  /** Null where that side holds no reading of this stream at all; the cell
   *  prints empty, and `deltaMs` goes with it. */
  readonly pinnedMs: number | null;
  readonly currentMs: number | null;
  readonly deltaMs: number | null;
  readonly bandMs: number;
  /** How far the 10th-percentile frame moved, where both sides hold a GPU
   *  floor; null otherwise. Context for `deltaMs`, never a verdict input. */
  readonly floorDeltaMs: number | null;
  readonly verdict: PinVerdict;
  readonly note: string;
}

export interface PinDiff {
  readonly refusedWholeRun: string | null;
  readonly rows: readonly PinVerdictRow[];
  readonly refusals: readonly DiffRefusal[];
  /** Pin rows this run did not visit. Listed, never a refusal: a Tier 1 run
   *  measures two of the pin's ten and answers for those two. */
  readonly unmeasured: readonly string[];
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

const keyOf = (name: string, backend: string): string => `${name}|${backend}`;

export function pinKey(record: ScenarioRecord): string {
  return keyOf(record.name, record.backend.actual ?? 'unbooted');
}

/** Every canon row and the position a pin run takes it at — backend-major in
 *  canon order, so mw120|webgpu is 1 and lg|webgl2 is 10. A pin holds all of
 *  them and each at its own position (pins/README.md § Run position). */
export const CANON_POSITIONS: ReadonlyMap<string, number> = new Map(
  contextOrder(SCENARIO_NAMES, BACKENDS).map(({ name, backend }, i) => [keyOf(name, backend), i + 1]),
);

function clockOf(stats: DwellSummary): PinClock {
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
  if (record.recordCount === null) return 'no catalogue record count recorded — the rows cannot be placed on a scene';
  if (record.position == null) return 'no run position recorded — the row cannot be placed in a load history';
  // The pin holds no `params` of its own and is taken with every setup lever at
  // its default, so an empty record IS the pin's preconditions — and absent
  // already reads as the default (`./diff/diff-pure.ts`). Here rather than in
  // `compareToPin` alone because `--pin` reads this too: a forced dwell written
  // as the pin would carry its lever's cost in every later run's verdict.
  const precondition = preconditionRefusal({}, record.params);
  if (precondition !== null) return precondition;
  if (PIN_UNGATED_SCENARIOS[record.name] === undefined
    && gatingClock(record.dwell).clock.stateGuard === 'trending') {
    return 'the dwell trended across its quarters — it straddled a load-state transition';
  }
  return null;
}

/** A row taken where the pin run never takes it compares with nothing later:
 *  every comparison is at equal position (pins/README.md § Run position). */
function canonPositionRefusal(record: ScenarioRecord): string | null {
  const canon = CANON_POSITIONS.get(pinKey(record));
  if (canon === undefined || record.position === canon) return null;
  return `taken at position ${record.position}; the pin run takes ${pinKey(record)} at ${canon}`;
}

export interface RunSource {
  readonly file: PerfFile;
  /** How the pin cites this run (`citeRunPath`). */
  readonly sourceRun: string;
}

export interface PinSource {
  readonly version: string;
  readonly accepted: Readonly<Record<string, PinAcceptance>>;
}

/** Where a pinned row came from, and every run that could not supply it. */
export interface RowProvenance {
  readonly key: string;
  readonly sourceRun: string | null;
  readonly refusedIn: readonly { readonly sourceRun: string; readonly reason: string }[];
}

export interface PinSummary {
  readonly pin: PinFile | null;
  /** The chosen rows as one run, for `compareToPin` against the pin being
   *  replaced; its run block is the newest source's. */
  readonly merged: PerfFile | null;
  readonly refusals: readonly string[];
  readonly provenance: readonly RowProvenance[];
}

/**
 * Oldest first by `finishedAt`, whatever order the caller named them in. The
 * freshest steady reading is the one a pin should hold, and reading that off
 * the argument list made the rule a convention the caller could invert in
 * silence: the same two runs named the other way round moved eight of ten
 * rows to the older run while `takenAt` stayed the newer run's, so the file
 * claimed a take time eight of its own rows predated. Sorting here also puts
 * the adapter, git and version block the pin copies on the same run
 * `takenAt` names, which picking by position did not.
 *
 * Stable, so runs finishing in the same millisecond keep the order given.
 */
function oldestFirst(sources: readonly RunSource[]): readonly RunSource[] {
  return [...sources].sort((a, b) => a.file.run.finishedAt.localeCompare(b.file.run.finishedAt));
}

/** Why these runs are not one machine measuring one tree. */
function runIdentityRefusals(sources: readonly RunSource[]): string[] {
  const refusals: string[] = [];
  if (sources.length === 0) refusals.push('no run files');
  for (const { file, sourceRun } of sources) {
    if (adapterSlug(file.run.gpu) === null) refusals.push(`${sourceRun}: the run carried no adapter probe`);
    if (!file.run.browser.headless) refusals.push(`${sourceRun}: a headed run — headed and headless never compare`);
    if (file.scenarios.length === 0) refusals.push(`${sourceRun}: the run measured nothing`);
  }
  const slugs = new Set(sources.map((s) => adapterSlug(s.file.run.gpu)).filter((s) => s !== null));
  if (slugs.size > 1) {
    refusals.push(`the runs span adapters ${[...slugs].join(', ')} — a frame time is a property of the GPU that drew it`);
  }
  if (sources.length > 1) {
    const commits = new Set(sources.map((s) => s.file.run.git.commit));
    if (commits.size > 1) {
      refusals.push(
        `the runs span commits ${[...commits].map((c) => c.slice(0, 8)).join(', ')} — rows merge only across runs of one tree`,
      );
    }
    const dirty = sources.filter((s) => s.file.run.git.dirty).map((s) => s.sourceRun);
    if (dirty.length > 0) {
      refusals.push(`${dirty.join(', ')}: a dirty tree — two runs at one hash with uncommitted changes need not be one tree`);
    }
  }
  return refusals;
}

/** Union of the runs' keys, canon rows first in canon order. */
function keysAcross(sources: readonly RunSource[]): string[] {
  const keys = new Set(sources.flatMap((s) => s.file.scenarios.map(pinKey)));
  const rank = (key: string): number => CANON_POSITIONS.get(key) ?? Number.POSITIVE_INFINITY;
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function rowFrom(record: ScenarioRecord, sourceRun: string): PinRow {
  const dwell = record.dwell!;
  const compute = computeClock(dwell);
  return {
    key: pinKey(record),
    name: record.name,
    backend: record.backend.actual!,
    bufferMpx: record.bufferMpx!,
    recordCount: record.recordCount!,
    position: record.position!,
    idleRafMs: record.idleRafMs,
    readbackPerFrame: dwell.readbackPerFrame,
    splitFrame: splitFrameClasses(dwell.passCounts),
    frames: dwellFrames(record),
    method: record.method!,
    wall: { ...clockOf(dwell.stats), vsyncClamped: dwell.stats.vsyncClamped },
    gpu: dwell.gpuStats === null ? null : clockOf(dwell.gpuStats),
    gpuFloor: dwell.gpuStats === null ? null : frameFloor(dwell.gpuMs),
    compute: compute === null ? null : clockOf(compute),
    computeFloor: compute === null ? null : frameFloor(dwell.computeMs),
    sourceRun,
  };
}

/**
 * Summarise one or more dwell-mode runs of the same commit as a pin, or say
 * why not. Each row is taken from the NEWEST run in which it is sound;
 * a row sound in no run refuses the whole pin, naming every run's reason,
 * because a pin missing a row would narrow the gate silently. Two cold runs
 * of identical code narrow nothing, so a row one run refused for straddling
 * a load state is taken from the run that held it steady — which is what
 * lets a pin come from saved runs without a second arm
 * (pins/README.md § From saved runs).
 */
export function pinFromRuns(given: readonly RunSource[], source: PinSource): PinSummary {
  const sources = oldestFirst(given);
  const refusals = runIdentityRefusals(sources);
  const byKey = sources.map(({ file, sourceRun }) => {
    const records = new Map<string, ScenarioRecord>();
    for (const record of file.scenarios) {
      const key = pinKey(record);
      if (records.has(key)) refusals.push(`${sourceRun}: visits ${key} more than once — a cadence probe, not a pin run`);
      records.set(key, record);
    }
    return { sourceRun, records };
  });

  const provenance: RowProvenance[] = [];
  const chosen: { record: ScenarioRecord; sourceRun: string }[] = [];
  for (const key of keysAcross(sources)) {
    const refusedIn: { sourceRun: string; reason: string }[] = [];
    let taken: { record: ScenarioRecord; sourceRun: string } | null = null;
    for (const { sourceRun, records } of byKey) {
      const record = records.get(key);
      if (record === undefined) continue;
      const why = rowRefusal(record) ?? canonPositionRefusal(record);
      if (why === null) taken = { record, sourceRun };
      else refusedIn.push({ sourceRun, reason: why });
    }
    provenance.push({ key, sourceRun: taken?.sourceRun ?? null, refusedIn });
    if (taken === null) {
      refusals.push(`${key}: ${refusedIn.map((r) => `${r.sourceRun}: ${r.reason}`).join('; ')}`);
    } else {
      chosen.push(taken);
    }
  }

  const newest = sources.at(-1);
  const slug = newest === undefined ? null : adapterSlug(newest.file.run.gpu);
  if (refusals.length > 0 || newest === undefined || slug === null || newest.file.run.gpu === null) {
    return { pin: null, merged: null, refusals, provenance };
  }
  return {
    pin: {
      schema: PIN_SCHEMA,
      adapterSlug: slug,
      adapter: newest.file.run.gpu,
      git: newest.file.run.git,
      version: source.version,
      takenAt: newest.file.run.finishedAt,
      sourceRuns: sources.map((s) => s.sourceRun),
      rows: chosen.map(({ record, sourceRun }) => rowFrom(record, sourceRun)),
      accepted: source.accepted,
    },
    merged: {
      schema: PERF_SCHEMA,
      run: newest.file.run,
      scenarios: chosen.map(({ record }) => record),
    },
    refusals,
    provenance,
  };
}

export function missingCanonRows(pin: PinFile): readonly string[] {
  const held = new Set(pin.rows.map((row) => row.key));
  return [...CANON_POSITIONS.keys()].filter((key) => !held.has(key));
}

/**
 * Runs are filed under `.perf-runs/<date>/` of the checkout they will be
 * committed from (README.md § Recording), so that is the path worth
 * committing: an absolute one names one machine's home directory, resolves
 * nowhere else, and this file ships in a public repo. A run stored outside
 * the checkout keeps its name and loses its location.
 *
 * `checkoutRoot` is the root of the checkout the run was WRITTEN in, which
 * from a worktree is the worktree — not the main checkout. Resolving against
 * the main checkout yields `.claude/worktrees/<name>/.perf-runs/…`, a path
 * that stops resolving the moment the worktree is removed, and a pin is
 * normally taken on a branch.
 */
export function citeRunPath(jsonPath: string, checkoutRoot: string): string {
  const rel = relative(checkoutRoot, resolve(jsonPath));
  return rel === '' || rel.startsWith('..') ? basename(jsonPath) : rel;
}

/** Which side is missing the stream, so an ungated row says why rather than
 *  only that it is ungated — the pin having one and the run not is an
 *  instrument regression, not the WebGL2 backend being itself. */
function ungatedNote(
  stream: 'GPU' | 'compute', backend: Backend, pinned: PinClock | null, current: DwellSummary | null,
): string {
  if (pinned === null && current === null) {
    return backend === 'webgl2'
      ? `no ${stream} stream — WebGL2 supplies none`
      : `no ${stream} stream on either side — the adapter resolved no believable durations`;
  }
  return pinned === null
    ? `the pin carries no ${stream} stream for this row; this run does`
    : `the pin carries a ${stream} stream for this row; this run resolved none`;
}

/** A reading one side does not hold prints empty rather than as a zero: a
 *  fabricated 0 makes `delta` restate `current` and reads as a move. */
function ungatedRow(
  key: string, metric: DwellMetric, pinnedMs: number | null, currentMs: number | null, note: string,
): PinVerdictRow {
  return {
    key,
    metric,
    pinnedMs,
    currentMs,
    deltaMs: pinnedMs === null || currentMs === null ? null : currentMs - pinnedMs,
    bandMs: 0,
    floorDeltaMs: null,
    verdict: 'ungated',
    note,
  };
}

/** The reader's discriminator on a mark: a cost every frame pays lifts the
 *  floor with the median; a wander lifts the upper half alone. */
function floorNote(row: PinVerdictRow): PinVerdictRow {
  if (row.verdict !== 'dearer' || row.floorDeltaMs === null || row.deltaMs === null || row.deltaMs <= 0) return row;
  if (row.floorDeltaMs >= FLOOR_FOLLOWS_FRACTION * row.deltaMs) return row;
  return {
    ...row,
    note: `floor moved ${row.floorDeltaMs.toFixed(3)} of ${row.deltaMs.toFixed(3)} — the upper half alone rose; read the quarters before accepting`,
  };
}

/** Applied to every row carrying a timestamp reading, ungated ones included:
 *  the ceiling is an absolute bound, and the rows the band cannot mark are
 *  exactly the ones with nothing else watching them. */
function underCeiling(row: PinVerdictRow): PinVerdictRow {
  if (row.currentMs === null || row.currentMs <= PIN_CEILING_MS) return row;
  return { ...row, verdict: 'dearer', note: `${row.metric} over the ${PIN_CEILING_MS} ms ceiling` };
}

/** One timestamp stream of a context and the two sides to judge it on. */
interface StreamSpec {
  readonly key: string;
  readonly metric: DwellMetric;
  readonly stream: 'GPU' | 'compute';
  readonly pinnedClock: PinClock | null;
  readonly pinnedFloor: FrameFloor | null;
  readonly current: DwellSummary | null;
  readonly currentSamples: readonly number[] | null | undefined;
  /** Shown in place of this stream's own readings where a side lacks it.
   *  The frame falls back to the wall clock every row carries; the compute
   *  row has no second clock, so null leaves its cells empty. */
  readonly ungatedContext: {
    readonly metric: DwellMetric;
    readonly pinnedMs: number;
    readonly currentMs: number;
  } | null;
}

/** One stream judged against its pinned twin: the band where both sides
 *  hold one, ungated by vantage or where a side lacks it, the ceiling on
 *  every reading. The frame's stream and the compute one are the same rule
 *  one field over (`pins/README.md` § The compute row). */
function streamRow(pinned: PinRow, spec: StreamSpec): PinVerdictRow {
  const { key, metric, pinnedClock, current } = spec;
  if (pinnedClock === null || current === null) {
    const note = ungatedNote(spec.stream, pinned.backend, pinnedClock, current);
    const context = spec.ungatedContext;
    return context === null
      ? ungatedRow(key, metric, pinnedClock?.p50 ?? null, current?.p50 ?? null, note)
      : ungatedRow(key, context.metric, context.pinnedMs, context.currentMs, note);
  }
  const floorDeltaMs = floorMove(spec.pinnedFloor, frameFloor(spec.currentSamples));
  const ungatedBecause = PIN_UNGATED_SCENARIOS[pinned.name];
  if (ungatedBecause !== undefined) {
    return underCeiling({
      ...ungatedRow(
        key, metric, pinnedClock.p50, current.p50,
        `${pinned.name} ${ungatedBecause} — recorded, never marked below the ceiling`,
      ),
      floorDeltaMs,
    });
  }
  const deltaMs = current.p50 - pinnedClock.p50;
  const bandMs = band(
    medianStandardErrorMs(pinnedClock), medianStandardErrorMs(current), dwellFloorMs(pinnedClock.p50),
  );
  return underCeiling(floorNote({
    key, metric, pinnedMs: pinnedClock.p50, currentMs: current.p50,
    deltaMs, bandMs, floorDeltaMs, verdict: verdictFor(deltaMs, bandMs), note: '',
  }));
}

function compareRows(pinned: PinRow, dwell: DwellRecord): PinVerdictRow[] {
  const frame = streamRow(pinned, {
    key: pinned.key,
    metric: 'gpu-p50',
    stream: 'GPU',
    pinnedClock: pinned.gpu,
    pinnedFloor: pinned.gpuFloor,
    current: dwell.gpuStats,
    currentSamples: dwell.gpuMs,
    ungatedContext: { metric: 'wall-p50', pinnedMs: pinned.wall.p50, currentMs: dwell.stats.p50 },
  });
  const pinnedCompute = pinned.compute ?? null;
  const compute = computeClock(dwell);
  if (pinnedCompute === null && compute === null) return [frame];
  return [frame, streamRow(pinned, {
    key: `${pinned.key}|${COMPUTE_ROW}`,
    metric: 'compute-p50',
    stream: 'compute',
    pinnedClock: pinnedCompute,
    pinnedFloor: pinned.computeFloor ?? null,
    current: compute,
    currentSamples: dwell.computeMs,
    ungatedContext: null,
  })];
}

/**
 * A run against the pin. The refusals are the point as much as the rows:
 * a different GPU, a headed run, a resized buffer, a context that
 * straddled the load transition or one taken at another position in its
 * run produce a table that looks like a comparison and is not.
 *
 * Walks the RUN's rows, not the pin's: a Tier 1 run visits two of the
 * pin's ten contexts and answers for those two, so a pin row it never
 * measured is listed as such rather than refused. A row the run measured
 * and the pin lacks is refused — the pin is the whole canon, so that row
 * has nothing to be judged against.
 */
export function compareToPin(pin: PinFile, current: PerfFile): PinDiff {
  const slug = adapterSlug(current.run.gpu);
  const refused = (why: string): PinDiff => ({ refusedWholeRun: why, rows: [], refusals: [], unmeasured: [] });
  if (slug !== pin.adapterSlug) {
    return refused(`adapter '${slug ?? 'none'}' vs pin '${pin.adapterSlug}' — a frame time is a property of the GPU that drew it`);
  }
  if (!current.run.browser.headless) {
    return refused('a headed run — the pin is headless, and the two never compare');
  }
  const rows: PinVerdictRow[] = [];
  const refusals: DiffRefusal[] = [];
  const pinnedByKey = new Map(pin.rows.map((row) => [row.key, row]));
  const visited = new Set<string>();
  for (const record of current.scenarios) {
    const key = pinKey(record);
    visited.add(key);
    // Before the lookup: a scenario that never booted keys as `<name>|unbooted`,
    // which the pin cannot hold, so the lookup would answer "not in the pin"
    // about a row whose real trouble is that it failed.
    const why = rowRefusal(record);
    if (why !== null) {
      refusals.push({ key, reason: why });
      continue;
    }
    const pinned = pinnedByKey.get(key);
    if (pinned === undefined) {
      refusals.push({ key, reason: 'not in the pin — nothing to judge it against' });
      continue;
    }
    const dwell = record.dwell!;
    const incomparable = bufferRefusal(pinned.bufferMpx, record.bufferMpx!)
      ?? recordCountRefusal(pinned.recordCount, record.recordCount)
      ?? positionRefusal(pinned.position, record.position)
      ?? framesRefusal(pinned.frames, dwellFrames(record))
      // Gated on the pin holding a GPU stream for the row, matching the clock
      // `compareRows` goes on to judge: a pair with none is printed ungated and
      // never marked, so narrowing it would refuse a row nothing reads.
      ?? (pinned.gpu === null || dwell.gpuStats === null ? null : readbackRefusal(
        pinned.readbackPerFrame, dwell.readbackPerFrame,
        splitFrameClasses(dwell.passCounts) || pinned.splitFrame === true,
      ));
    if (incomparable !== null) {
      refusals.push({ key, reason: incomparable });
      continue;
    }
    rows.push(...compareRows(pinned, dwell));
  }
  const unmeasured = pin.rows.map((row) => row.key).filter((key) => !visited.has(key));
  return { refusedWholeRun: null, rows, refusals, unmeasured };
}

/**
 * Whether a comparison fails the run. A per-row refusal counts: a run whose
 * rows were every one refused — all trending, all resized — would otherwise
 * print a table with no `✗` in it and exit 0, which reads as a pass. An
 * unmeasured pin row does not: the run answers for the rows it visited.
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

/**
 * Why a summarised pin must not be written, or null. Both writers — the
 * runner's `--pin` and the offline `perf:pin` — ask this and nothing else
 * after `pinFromRuns`, so the two cannot come to refuse different pins.
 * `against` is the comparison with the pin being replaced, where one exists.
 */
export function pinWriteRefusal(pin: PinFile, against: PinDiff | null): string | null {
  const missing = missingCanonRows(pin);
  if (missing.length > 0) {
    return `the pin would lack ${missing.join(', ')} — a pin missing a row narrows the gate silently`;
  }
  if (against !== null) {
    const unaccepted = unacceptedMarks(against, pin.accepted);
    if (unaccepted.length > 0) {
      return `${unaccepted.join(', ')} marked ✗ against the pin being replaced. ` +
        'Fix the regression, or re-run with --accept <row>:<bead-id> to pin the accepted value.';
    }
  }
  return null;
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

/** Whether the pin's recorded `commit` resolves on main as git answers it
 *  *now* — not as it answered when the pin was taken. A branch tip that has
 *  since squash-merged reads `unlanded` forever: the measured tree landed,
 *  under another hash. `unknown` is an unreadable object or no `origin/main`. */
export type PinCommitState = 'landed' | 'unlanded' | 'unknown';

/**
 * `git merge-base --is-ancestor` answers in exit codes, and only **1** means
 * "asked and answered no". Every other non-zero status is the question having
 * failed — an unknown object, no `origin/main`, a broken repository — and
 * reading those as `unlanded` would print a confident "pre-squash branch tip"
 * line about a commit git never resolved.
 */
export function commitStateFromExitStatus(status: number | undefined): PinCommitState {
  if (status === 0) return 'landed';
  return status === 1 ? 'unlanded' : 'unknown';
}

/** `git diff --shortstat <pin main base> <run main base> -- src/client`:
 *  main's own render-path movement between the two trees. Read A-to-B, in
 *  that order — a branch cut before the pin was taken has the older base,
 *  and calling the counts "since the pin" would then have them backwards. */
export interface RenderPathDrift {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
}

const SHORTSTAT = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;

/**
 * Read a `--shortstat` line. An empty line is git saying the two trees are
 * identical under the pathspec, which is a drift of zero and not a failure
 * to measure one — the difference decides whether the header stays silent or
 * says the drift could not be read. Either count is absent when it is zero,
 * so a deletion-only diff prints no insertions clause at all.
 */
export function parseRenderPathDrift(shortstat: string): RenderPathDrift | null {
  if (shortstat.trim() === '') return { files: 0, insertions: 0, deletions: 0 };
  const m = SHORTSTAT.exec(shortstat);
  if (m === null) return null;
  return { files: Number(m[1]), insertions: Number(m[2] ?? 0), deletions: Number(m[3] ?? 0) };
}

/**
 * What the `--against-pin` header must say about the tree the pin measured,
 * before any row is read.
 *
 * A mark is only the PR's if nothing else moved the frame in between, and a
 * pin cites a branch tip: squash-merge means that hash carries no landed
 * tree, so the drift it hides is attributed to whoever runs next. One pin
 * sat at an unlanded tip for two days and charged four consecutive PRs —
 * one of them with no per-frame code at all — for ~1,600 insertions of
 * main's own render-path work.
 *
 * Reported rather than refused: taking a pin on a branch is the normal case,
 * and a refusal would leave no usable pin at the moment one is most wanted.
 * The row-level refusals stay for what is measurable — adapter, buffer,
 * record count, state guard — and this names what a reader must weigh.
 */
export function pinProvenanceLines(
  pin: PinFile,
  state: PinCommitState,
  drift: RenderPathDrift | null,
  runMainCommit: string | null,
): readonly string[] {
  const short = pin.git.commit.slice(0, 8);
  const lines: string[] = [];
  if (state === 'unlanded') {
    lines.push(
      `pin commit ${short} is not an ancestor of origin/main — a pre-squash branch tip, ` +
      'so no hash on main carries the tree it measured',
    );
  } else if (state === 'unknown') {
    lines.push(`pin commit ${short} could not be placed against origin/main — drift is unbounded`);
  }
  if (pin.git.mainCommit === null) {
    lines.push('the pin records no main base, so its drift from main cannot be measured at all');
  } else if (drift === null) {
    lines.push(`pin main base ${pin.git.mainCommit.slice(0, 8)}; render-path drift could not be read`);
  } else if (drift.files > 0) {
    // Both bases named, and the counts read in that direction: whichever is
    // the older tree, `git diff A B -- src/client` is the command that
    // reproduces the line, and "moved since the pin" would not be.
    const from = pin.git.mainCommit.slice(0, 8);
    const to = runMainCommit === null ? 'unrecorded base' : runMainCommit.slice(0, 8);
    lines.push(
      `main's src/client differs from the pin's base ${from} to this run's ${to}: ` +
      `${drift.files} file${drift.files === 1 ? '' : 's'}, +${drift.insertions}/-${drift.deletions} — ` +
      'a mark below may be that difference rather than this diff',
    );
  }
  return lines;
}
