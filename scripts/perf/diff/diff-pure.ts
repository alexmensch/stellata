// Two perf runs, differenced: which rows moved further than the pair's own
// uncertainty, and which pairs are not comparable at all.
// README.md.

import { medianStandardErrorMs } from '../../../src/client/debug/frame-cost/frame-cost-pure';
import {
  EMPTY_PASSES_DEFAULT, EMPTY_PASS_KEY,
} from '../../../src/client/debug/frame-cost/passes/passes-pure';
import {
  COMPUTE_ROW, classClock, computeClock, floorMove, frameFloor, gatingClock, sampleClasses,
  spreadMove, type ClassClock, type DwellMetric,
} from '../dwell/dwell-pure';
import type { DwellRecord, PerfFile, ScenarioRecord } from '../schema';
import type { ScenarioName } from '../scenarios';

/** How far the two buffers may differ and still be compared. Both dominant
 *  passes scale with area, so a resized window is a different measurement
 *  wearing the same row label. */
export const BUFFER_MPX_TOLERANCE = 0.01;

/** How far the two catalogues may differ and still price the same scene.
 *  The same 1 % the buffer gets, and for the same kind of reason: the star
 *  passes' cost scales with the record count, so the question is whether the
 *  difference can reach the band. 1 % of the present catalogue is ~3,900
 *  records, and the measured step for 54,458 was 0.39–0.59 ms of GPU frame
 *  (`RELEASING.md` § Perf pin), so pro rata ~0.03–0.04 ms against a pin
 *  floor of `max(0.25 ms, 1 %)` — an order of magnitude under the smallest
 *  delta a row can be marked for. Also the bound
 *  `perf-section-check.sh` requires a re-take past, so a membership change
 *  that owes no `## Perf` section cannot leave a pin that refuses. */
export const RECORD_COUNT_TOLERANCE = 0.01;

/** How far the exposure readback's duty cycle may move before a two-class
 *  frame's GPU-stream median stops being comparable. Across 25 cold archived
 *  earth dwells the rate holds 0.2375–0.2542, a 7 % spread, while the dwell
 *  that read 52.8 ms against a 17.2 ms pin sat at 0.5792 — so the bound has
 *  the same order of headroom over the sound spread that `DWELL_FLOOR_MS`
 *  has over the cold-to-cold move it covers, and is still a quarter of the
 *  distance to the artefact. */
export const READBACK_TOLERANCE = 0.25;

/** A row has to move further than this multiple of the pair's combined
 *  standard error to count. Two sigma either side, not one: a one-sigma
 *  band calls roughly a third of unchanged rows a regression. */
export const BAND_SIGMAS = 2;

/** The floor under every whole-frame band, in both gates. Two sigma of the
 *  medians' own scatter describes sampling alone, and a dwell's run
 *  conditions move it further than that: the same vantage read 21.950 and
 *  21.464 ms across two runs of identical code, differing only in where the
 *  context sat in its run. Both forms were derived from the cold-to-cold
 *  spread of two pins on identical code — `../pins/README.md` § Reading
 *  `--against-pin`.
 *
 *  Here rather than in `pin-pure.ts` because `--baseline` and
 *  `--against-pin` must floor the same row the same way: the tighter of two
 *  gates decides, so a Tier 1 band under the Tier 2 one it feeds marks a
 *  change Tier 2 would call unresolved (`RELEASING.md` § Perf pin). */
export const DWELL_FLOOR_MS = 0.25;
export const DWELL_FLOOR_FRACTION = 0.01;

/** 1.5× each vantage's p10 scatter, rounded up to 0.05 — the derivation and
 *  the measurement are `../pins/README.md` § The compute row. */
export const COMPUTE_SCATTER_FLOOR_MS: Readonly<Record<ScenarioName, number>> = {
  mw120: 0.05,
  sol: 0.15,
  earth: 0.10,
  mw50: 0.05,
  lg: 0.45,
};

function floorFor(floorMs: number, baselineMs: number): number {
  return Math.max(floorMs, DWELL_FLOOR_FRACTION * baselineMs);
}

export function dwellFloorMs(baselineMs: number): number {
  return floorFor(DWELL_FLOOR_MS, baselineMs);
}

/** Capped at `DWELL_FLOOR_MS`, so a re-floor only ever tightens.
 *
 *
 *  A name off a parsed run or pin need not be one of the canon five — neither
 *  file's assertion checks it — so the lookup falls back rather than banding
 *  the row on a `NaN` every delta marks against. */
export function computeFloorMs(name: ScenarioName, baselineMs: number): number {
  const derived: number | undefined = COMPUTE_SCATTER_FLOOR_MS[name];
  return floorFor(Math.min(derived ?? DWELL_FLOOR_MS, DWELL_FLOOR_MS), baselineMs);
}

export type Verdict = 'cheaper' | 'dearer' | 'same';

export const VERDICT_MARK: Record<Verdict, string> = {
  cheaper: '✓',
  dearer: '✗',
  same: '~',
};

export interface DiffRow {
  readonly key: string;
  /** `savedMs` for a differential row, one of the two clocks' p50 for a
   *  dwell. All read upward-is-dearer, which is the trap in `savedMs`: the
   *  field names what disabling the pass saved, i.e. the pass's own price,
   *  so a bigger number is a costlier pass and not a bigger win. */
  readonly metric: 'savedMs' | DwellMetric;
  readonly baselineMs: number;
  readonly currentMs: number;
  readonly deltaMs: number;
  /** How far the 10th-percentile frame moved, on a dwell row the GPU stream
   *  gates; null on every other row. Context for `deltaMs`, never a verdict
   *  input — the same column the pin prints, off the same statistic, because
   *  a reader asking "cost or wander?" must not have to ask it differently
   *  of the two tables. */
  readonly floorDeltaMs: number | null;
  /** How far `p90 - p10` moved; null off a dwell row. Never a verdict input
   *  — README.md, on the `spread` column. */
  readonly spreadDeltaMs: number | null;
  readonly bandMs: number;
  readonly verdict: Verdict;
}

export interface DiffRefusal {
  readonly key: string;
  readonly reason: string;
}

export interface RunDiff {
  /** Set when the two runs cannot be compared at all. No rows are
   *  produced: a per-row verdict would imply the comparison was valid. */
  readonly refusedWholeRun: string | null;
  readonly rows: readonly DiffRow[];
  readonly refusals: readonly DiffRefusal[];
}

function adapterKey(file: PerfFile): string {
  const gpu = file.run.gpu;
  if (gpu === null) return '(no adapter probe)';
  return `${gpu.webgl?.renderer ?? 'no-webgl'} / ${gpu.webgpu?.device || gpu.webgpu?.description || 'no-webgpu'}`;
}

function scenarioKey(record: ScenarioRecord): string {
  return `${record.name}|${record.backend.actual ?? 'unbooted'}`;
}

/**
 * Why a baseline scenario found no partner. The key already carries the
 * backend, so a WebGL2 baseline against a WebGPU run reads as an absent
 * scenario unless the vantage is checked separately — and "you measured a
 * different backend" is the fixable half of that.
 */
function absenceReason(record: ScenarioRecord, current: readonly ScenarioRecord[]): string {
  const backends = current
    .filter((s) => s.name === record.name)
    .map((s) => s.backend.actual ?? 'unbooted');
  if (backends.length === 0) return 'scenario absent from the current run';
  return (
    `measured on ${backends.join(' and ')} in the current run, ${record.backend.actual ?? 'unbooted'} ` +
    'in the baseline — a frame time is a property of the backend that drew it'
  );
}

function comparabilityRefusal(a: ScenarioRecord, b: ScenarioRecord): string | null {
  if (a.method !== b.method) {
    return `method ${a.method ?? 'none'} vs ${b.method ?? 'none'} — three different instruments, never comparable`;
  }
  if (a.mode !== b.mode) return `mode ${a.mode} vs ${b.mode}`;
  const [ma, mb] = [a.bufferMpx, b.bufferMpx];
  if (ma === null || mb === null) return 'one run recorded no drawing buffer';
  return bufferRefusal(ma, mb)
    ?? recordCountRefusal(a.recordCount, b.recordCount)
    ?? positionRefusal(a.position, b.position)
    ?? framesRefusal(dwellFrames(a), dwellFrames(b))
    ?? preconditionRefusal(a.params, b.params);
}

/** The two-state setup levers, in the order they are refused. A `false` here
 *  is also what an absent field reads as, so a new lever needs no migration —
 *  add the row and both gates refuse it. */
const BOOLEAN_PRECONDITIONS = [
  {
    field: 'noPark', name: 'adaptation park', whenTrue: 'off', whenFalse: 'live',
    why: 'one run priced the statistic writes and the other priced them parked',
  },
  {
    field: 'forceRecompute', name: 'extinction recompute', whenTrue: 'forced', whenFalse: 'gated',
    why: 'one run marched every star every frame and the other marched none',
  },
] as const;

export function preconditionRefusal(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): string | null {
  const heldOff = (p: Readonly<Record<string, unknown>>): string => {
    const keys = (p.preDisable as readonly string[] | undefined) ?? [];
    return keys.length === 0 ? 'none' : [...keys].sort().join(',');
  };
  const [ha, hb] = [heldOff(a), heldOff(b)];
  if (ha !== hb) {
    return `passes held off ${ha} vs ${hb} — a pre-disabled sweep prices a frame the other run did not draw`;
  }
  for (const lever of BOOLEAN_PRECONDITIONS) {
    const state = (p: Readonly<Record<string, unknown>>): string =>
      (p[lever.field] === true ? lever.whenTrue : lever.whenFalse);
    const [sa, sb] = [state(a), state(b)];
    if (sa !== sb) return `${lever.name} ${sa} vs ${sb} — ${lever.why}`;
  }
  const interleaved = (p: Readonly<Record<string, unknown>>): boolean => p.interleave !== false;
  if (interleaved(a) !== interleaved(b)) {
    return 'one sweep bracketed each row and the other differenced against the leading baseline — two estimators';
  }
  return null;
}

/** How far `b` sits from `a`, as a fraction of `a`. Equal values short out
 *  before the division so that two zeroes read as no drift rather than NaN,
 *  which would slip past every `>` test below. */
function relativeDrift(a: number, b: number): number {
  return a === b ? 0 : Math.abs(b - a) / a;
}

/** A resized window is a different measurement wearing the same row label:
 *  both dominant passes scale with area. Shared with `--against-pin`, as
 *  the record-count and position refusals below it are. */
export function bufferRefusal(a: number, b: number): string | null {
  const drift = relativeDrift(a, b);
  if (drift <= BUFFER_MPX_TOLERANCE) return null;
  return `buffer ${a} vs ${b} Mpx (${(drift * 100).toFixed(1)} % apart) — the frame is fill-bound`;
}

/**
 * Two rows compare only at the same position in their runs. The GPU's load
 * history before a context moves its frame on unchanged code, and each run's
 * own state guard reads steady throughout, so nothing else catches it. A
 * cool-down does not reset it — position, not idle time, is the variable.
 * Absent on either side refuses as an absent count does.
 */
export function positionRefusal(a: number | null | undefined, b: number | null | undefined): string | null {
  if (a == null || b == null) {
    return `run position ${a ?? 'unknown'} vs ${b ?? 'unknown'} — a run that did not record where each context sat cannot be placed in a load history`;
  }
  if (a !== b) {
    return `run position ${a} vs ${b} — the GPU's load history before a context moves its frame on unchanged code`;
  }
  return null;
}

/**
 * Two dwells compare only over the same number of timed frames. A median
 * converges with dwell length rather than merely getting quieter: at the
 * runner's default 240 the mw120 GPU median has not settled — eight archived
 * rows span 0.725 ms against a 0.25 ms band. So a 240-frame row read against
 * a 960-frame one is two statistics, not two readings. 960 makes them
 * comparable without making either quiet, which is the re-run rule's job
 * rather than this refusal's (`RELEASING.md` § What a mark means).
 *
 * Nothing else catches it: the state guard compares quarters within one
 * dwell and both read steady, and the band is computed from the pair and
 * widens with neither. A pin re-taken at the wrong length therefore replaces
 * a good one silently, which is what this refuses.
 *
 * ABSENT on either side declines the guard rather than refusing, as
 * `readbackPerFrame` does — a pin written before the field existed stays
 * usable, and only a known mismatch refuses.
 */
/** The dwell length off the record's own params, where the runner stamps the
 *  `--frames` it honoured. Undefined rather than a guess on a record that
 *  carries none, which `framesRefusal` declines rather than refuses. */
export function dwellFrames(record: ScenarioRecord): number | undefined {
  const frames = record.params?.frames;
  return typeof frames === 'number' ? frames : undefined;
}

export function framesRefusal(
  a: number | null | undefined, b: number | null | undefined,
): string | null {
  if (a == null || b == null || a === b) return null;
  return `dwell ${a} vs ${b} frames — a median converges with dwell length, so these are two statistics rather than two readings`;
}

/**
 * A record-set change moves how many instanced quads every star pass draws,
 * which is the most direct frame-cost change the repo can make. So the count
 * is checked here rather than trusted to a diff trigger: a row priced
 * against a different scene is not a comparison, and refusing beats marking.
 *
 * An ABSENT count refuses whatever its size would have been — nothing places
 * the row on a scene at all, and a run written before the field existed is
 * indistinguishable from one that failed to read it.
 */
export function recordCountRefusal(a: number | null, b: number | null): string | null {
  if (a === null || b === null) {
    return `record count ${a ?? 'unknown'} vs ${b ?? 'unknown'} — a run that did not record one cannot be placed on a scene`;
  }
  const drift = relativeDrift(a, b);
  if (drift > RECORD_COUNT_TOLERANCE) {
    return `catalogue ${a} vs ${b} records (${(drift * 100).toFixed(1)} % apart) — every star pass draws a different scene`;
  }
  return null;
}

/**
 * Whether the vantage draws two classes of frame, read off the per-frame
 * render-pass counts the dwell already records. A readback frame carries the
 * reduction chain's extra passes, so where the exposure measurement draws
 * under the dwell's pinned cut the counter is bimodal and `min` differs from
 * `max`; where every frame is the same shape the two agree.
 *
 * This is the condition the readback guard below turns on, and it is a
 * property of the vantage rather than of the run: earth is bimodal in all 23
 * archived WebGPU dwells that carry counters, and mw120, sol, mw50 and lg in
 * none of their 109. A WebGL2 dwell has no queue to count on and records
 * nothing, which reads here as a single class — correctly, since that backend
 * supplies no GPU stream for the guard to protect.
 *
 * A run written before the counters existed carries no field at all rather
 * than a null, and 31 of the 257 archived dwells are such runs — 16 of them
 * with a resolved stream, so a `--baseline` against one reaches here. Absent
 * reads as a single class for the same reason an unrecorded rate declines the
 * guard: this one narrows an already-gated comparison rather than answering
 * what a row cannot be read without.
 */
export function splitFrameClasses(counts: DwellRecord['passCounts'] | undefined): boolean {
  if (counts == null) return false;
  const { min, max } = counts.summary.renderPasses;
  return min !== max;
}

/**
 * Two dwells at different exposure-readback duty cycles, where the frame has
 * two classes. The stream samples over half the rendered frames, so the
 * sampled mix is the frame population's and the median lands in whichever
 * class holds the majority. Both classes cost the same at every duty cycle —
 * 11.9-14.1 ms and 51.1-58.6 at earth — and only their share moves, so the
 * median steps 4.3x as that share crosses a half while the wall p50 holds at
 * 16.70 ms. A median taken at one duty cycle is therefore not the same
 * statistic as one taken at another (`dwell/README.md`).
 *
 * The share rises with the rate rather than equalling it: the sampler takes
 * the two classes evenly at one-in-two and sparser, and 0.89 of readback
 * frames against 0.12 of plain ones at one-in-one. Rising is what this guard
 * turns on, so the skew costs it nothing.
 *
 * Gated on the frame being split, because the same drift elsewhere is sound
 * and refusing it would throw away real readings: sol moved 0.25 to 0.59
 * across the runs that measured its 9.33 ms saving, and mw120 to 0.51 with
 * its median flat to a twentieth of a millisecond.
 *
 * An unrecorded rate declines the guard rather than refusing the row. The
 * other identity refusals answer a question a row cannot be read without —
 * which scene, which position — while this one narrows an already-gated
 * comparison, and a comparison that refuses every row until a cold pin is
 * re-taken costs an idle machine to protect readings the remaining guards
 * already hold.
 */
export function readbackRefusal(
  a: number | null | undefined,
  b: number | null | undefined,
  splitFrame: boolean,
): string | null {
  if (!splitFrame || a == null || b == null) return null;
  const drift = relativeDrift(a, b);
  if (drift <= READBACK_TOLERANCE) return null;
  return (
    `exposure readback ${a.toFixed(3)} vs ${b.toFixed(3)} per frame ` +
    `(${(drift * 100).toFixed(1)} % apart) — this vantage draws a readback frame and a plain ` +
    'one, and the GPU stream samples only the readback frames, so its median follows the duty cycle'
  );
}

export function verdictFor(deltaMs: number, bandMs: number): Verdict {
  if (Math.abs(deltaMs) <= bandMs) return 'same';
  return deltaMs < 0 ? 'cheaper' : 'dearer';
}

export function band(seA: number, seB: number, floorMs: number): number {
  return Math.max(BAND_SIGMAS * Math.hypot(seA, seB), floorMs);
}

function differentialRows(key: string, a: ScenarioRecord, b: ScenarioRecord): {
  rows: DiffRow[];
  refusals: DiffRefusal[];
} {
  const rows: DiffRow[] = [];
  const refusals: DiffRefusal[] = [];
  const current = new Map((b.differential ?? []).map((row) => [row.pass, row]));
  for (const baseline of a.differential ?? []) {
    const row = current.get(baseline.pass);
    if (row === undefined) {
      refusals.push({ key: `${key}|${baseline.pass}`, reason: 'row absent from the current run' });
      continue;
    }
    if (baseline.cadenceBound === true || row.cadenceBound === true) {
      refusals.push({
        key: `${key}|${baseline.pass}`,
        reason: 'a raf-delta row the display cadence set — the wall clock cannot show a sub-interval delta',
      });
      continue;
    }
    // Row-level rather than in `preconditionRefusal`: the count reaches this
    // one row and refusing the scenario for it would drop twelve sound ones.
    if (baseline.pass === EMPTY_PASS_KEY) {
      const count = (p: Readonly<Record<string, unknown>>): number =>
        (p.emptyPasses as number | undefined) ?? EMPTY_PASSES_DEFAULT;
      const [ea, eb] = [count(a.params), count(b.params)];
      if (ea !== eb) {
        refusals.push({
          key: `${key}|${baseline.pass}`,
          reason: `${ea} vs ${eb} empty passes added — the row is a bound on that many boundaries together, not a per-pass cost`,
        });
        continue;
      }
    }
    const deltaMs = row.savedMs - baseline.savedMs;
    // The bracket floor overrides the standard error whenever it is
    // larger: it is how far the instrument moved between the baselines
    // either side of the row, which no amount of sampling reduces.
    const floorMs = Math.max(baseline.bracketMs ?? 0, row.bracketMs ?? 0);
    const bandMs = band(baseline.noiseMs, row.noiseMs, floorMs);
    rows.push({
      key: `${key}|${baseline.pass}`,
      metric: 'savedMs',
      baselineMs: baseline.savedMs,
      currentMs: row.savedMs,
      deltaMs,
      floorDeltaMs: null,
      spreadDeltaMs: null,
      bandMs,
      verdict: verdictFor(deltaMs, bandMs),
    });
  }
  return { rows, refusals };
}

/**
 * The whole-frame row, judged on the clock `gatingClock` names — the GPU
 * stream where both sides resolved one, wall only where neither did. Every
 * test below reads that same clock, which is the rule `gatingClock`'s own
 * docstring states: a gate may stand down on a clock only where the band
 * does not mark it.
 *
 * The wall clock is quantised to the refresh interval, so at a vantage whose
 * frame exceeds one interval its median alternates between one and two and
 * both the clamp test and the state guard fire on a machine that never
 * moved. Read off the GPU stream those two tests are about the hardware
 * instead — which is what lets a vantage over one interval be compared at
 * all.
 *
 * Where NEITHER side resolved a stream this row still marks, on wall, and
 * that is where it parts company with the pin: `compareToPin` prints such a
 * pair `ungated` and never marks it. The pin can afford to, having five
 * vantages on two backends to fall back on; refusing here would leave
 * `--baseline --mode dwell --backend webgl2` with no row at all, WebGL2
 * supplying no stream anywhere. The quantisation is why such a row is worth
 * little: it is the one case in this function where a whole-interval delta
 * can be an artefact of the clock rather than the frame.
 */
function dwellRows(key: string, a: ScenarioRecord, b: ScenarioRecord): (DiffRow | DiffRefusal)[] {
  const [da, db] = [a.dwell, b.dwell];
  if (da === null || db === null) {
    return [{ key: `${key}|dwell`, reason: 'one run has no dwell record' }];
  }
  const frame = frameRow(key, da, db);
  return 'reason' in frame ? [frame] : [frame, ...computeRow(key, a.name, da, db)];
}

/** README.md, on the compute row; why the p10, `../pins/README.md` § The
 *  compute row. */
function computeRow(
  key: string, name: ScenarioName, da: DwellRecord, db: DwellRecord,
): (DiffRow | DiffRefusal)[] {
  const [ca, cb] = [computeClock(da), computeClock(db)];
  if (ca === null && cb === null) return [];
  if (ca === null || cb === null) {
    return [{
      key: `${key}|${COMPUTE_ROW}`,
      reason: 'one run recorded a compute stream for this row and the other did not',
    }];
  }
  const [fa, fb] = [frameFloor(da.computeMs), frameFloor(db.computeMs)];
  if (fa === null || fb === null) {
    return [{
      key: `${key}|${COMPUTE_ROW}`,
      reason: 'one run retained no compute samples, so the p10 the row is gated on cannot be read',
    }];
  }
  const deltaMs = fb.p10 - fa.p10;
  const bandMs = computeFloorMs(name, fa.p10);
  return [{
    key: `${key}|${COMPUTE_ROW}`,
    metric: 'compute-p10',
    baselineMs: fa.p10,
    currentMs: fb.p10,
    deltaMs,
    floorDeltaMs: null,
    spreadDeltaMs: spreadMove({ p10: fa.p10, p90: ca.p90 }, { p10: fb.p10, p90: cb.p90 }),
    bandMs,
    verdict: verdictFor(deltaMs, bandMs),
  }];
}

function frameRow(key: string, da: DwellRecord, db: DwellRecord): DiffRow | DiffRefusal {
  if ((da.gpuStats === null) !== (db.gpuStats === null)) {
    return {
      key: `${key}|dwell`,
      reason:
        'one run resolved a GPU stream for this row and the other did not — a GPU-stream ' +
        'median against a wall median is two instruments, the same refusal a differing method gets',
    };
  }
  const [ga, gb] = [gatingClock(da), gatingClock(db)];
  const [ca, cb] = [ga.clock, gb.clock];
  if (ca.vsyncClamped || cb.vsyncClamped) {
    return {
      key: `${key}|dwell`,
      reason: 'a dwell was vsync-clamped — it measured the panel, not the frame',
    };
  }
  if ([ca, cb].some((c) => c.stateGuard === 'trending')) {
    return {
      key: `${key}|dwell`,
      reason: 'a dwell trended across its quarters — it straddled a load-state transition',
    };
  }
  // Only where the GPU stream is the clock being judged: the duty cycle
  // reaches the median by way of which frames that stream samples, and the
  // wall row it would otherwise refuse sat on 16.70 ms throughout.
  if (ga.metric === 'gpu-p50') {
    const split = splitFrameClasses(da.passCounts) || splitFrameClasses(db.passCounts);
    const drifted = readbackRefusal(da.readbackPerFrame, db.readbackPerFrame, split);
    if (drifted !== null) return { key: `${key}|dwell`, reason: drifted };
  }
  const [ja, jb] = [judgedFrameStat(da, ga), judgedFrameStat(db, gb)];
  if (ja.metric !== jb.metric) {
    return {
      key: `${key}|dwell`,
      reason:
        `${ja.metric} vs ${jb.metric} — one run's frame separated into two pass classes and the ` +
        "other's did not, and a plain-class median against a mixture median is two statistics",
    };
  }
  const deltaMs = jb.clock.p50 - ja.clock.p50;
  const bandMs = band(
    medianStandardErrorMs(ja.clock), medianStandardErrorMs(jb.clock), dwellFloorMs(ja.clock.p50),
  );
  // Off the GPU stream alone. A wall floor is quantised to the refresh
  // interval exactly as its median is, so its p10 is the same value the
  // median already reports and the column would answer nothing.
  const [fa, fb] = ga.metric === 'wall-p50'
    ? [null, null]
    : [frameFloor(da.gpuMs), frameFloor(db.gpuMs)];
  return {
    key: `${key}|dwell`,
    metric: ja.metric,
    baselineMs: ja.clock.p50,
    currentMs: jb.clock.p50,
    deltaMs,
    floorDeltaMs: floorMove(fa, fb),
    spreadDeltaMs: spreadMove(
      { p10: fa?.p10 ?? null, p90: ca.p90 }, { p10: fb?.p10 ?? null, p90: cb.p90 },
    ),
    bandMs,
    verdict: verdictFor(deltaMs, bandMs),
  };
}

/** The plain class where the vantage draws two, the whole dwell otherwise —
 *  `../pins/README.md` § The compute row, last. */
function judgedFrameStat(
  dwell: DwellRecord, gating: ReturnType<typeof gatingClock>,
): { readonly clock: ClassClock; readonly metric: DwellMetric } {
  if (gating.metric === 'wall-p50') return { clock: gating.clock, metric: gating.metric };
  const classes = splitFrameClasses(dwell.passCounts) ? sampleClasses(dwell.gpuMs) : null;
  return classes === null
    ? { clock: gating.clock, metric: 'gpu-p50' }
    : { clock: classClock(classes.plain), metric: 'gpu-plain-p50' };
}

/**
 * Refusals are the point of this
 * function as much as the rows are: two runs on different clocks, buffers
 * or adapters produce a table that looks like a comparison and is not, so
 * every incomparable pair is named rather than dropped.
 *
 * Both files reach here through `assertPerfFile`, which refuses a foreign
 * schema suffix before any field is read — so the schema is settled by
 * the time a diff is asked for, and this function does not re-litigate it.
 */
export function diffRuns(baseline: PerfFile, current: PerfFile): RunDiff {
  const [ka, kb] = [adapterKey(baseline), adapterKey(current)];
  if (ka !== kb) {
    return {
      refusedWholeRun: `adapter '${ka}' vs '${kb}' — a frame time is a property of the GPU that drew it`,
      rows: [],
      refusals: [],
    };
  }

  const rows: DiffRow[] = [];
  const refusals: DiffRefusal[] = [];
  const currentByKey = new Map(current.scenarios.map((s) => [scenarioKey(s), s]));
  for (const a of baseline.scenarios) {
    const key = scenarioKey(a);
    const b = currentByKey.get(key);
    if (b === undefined) {
      refusals.push({ key, reason: absenceReason(a, current.scenarios) });
      continue;
    }
    if (a.failed || b.failed || a.tainted || b.tainted) {
      refusals.push({ key, reason: 'a run of this scenario failed or was tainted' });
      continue;
    }
    const incomparable = comparabilityRefusal(a, b);
    if (incomparable !== null) {
      refusals.push({ key, reason: incomparable });
      continue;
    }
    if (a.differential !== null && b.differential !== null) {
      const diffed = differentialRows(key, a, b);
      rows.push(...diffed.rows);
      refusals.push(...diffed.refusals);
    }
    if (a.dwell !== null || b.dwell !== null) {
      for (const outcome of dwellRows(key, a, b)) {
        if ('reason' in outcome) refusals.push(outcome);
        else rows.push(outcome);
      }
    }
    if (a.sweep !== null || b.sweep !== null) {
      refusals.push({
        key: `${key}|sweep`,
        reason: 'sweep records carry a slope, not a cost — read the fits side by side instead',
      });
    }
  }
  return { refusedWholeRun: null, rows, refusals };
}
