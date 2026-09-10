// Two perf runs, differenced: which rows moved further than the pair's own
// uncertainty, and which pairs are not comparable at all.
// README.md § Comparing against a baseline.

import { medianStandardErrorMs } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { gatingClock, type DwellMetric } from './dwell/dwell-pure';
import type { PerfFile, ScenarioRecord } from './schema';

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

/** A row has to move further than this multiple of the pair's combined
 *  standard error to count. Two sigma either side, not one: a one-sigma
 *  band calls roughly a third of unchanged rows a regression. */
export const BAND_SIGMAS = 2;

/** The floor under every whole-frame band, in both gates. Two sigma of the
 *  medians' own scatter describes sampling alone, and a dwell's run
 *  conditions move it further than that: the same vantage read 21.950 and
 *  21.464 ms across two runs of identical code, differing only in where the
 *  context sat in its run. Both forms were derived from the cold-to-cold
 *  spread of two pins on identical code — `pins/README.md` § Reading
 *  `--against-pin`.
 *
 *  Here rather than in `pin-pure.ts` because `--baseline` and
 *  `--against-pin` must floor the same row the same way: the tighter of two
 *  gates decides, so a Tier 1 band under the Tier 2 one it feeds marks a
 *  change Tier 2 would call unresolved (`RELEASING.md` § Perf pin). */
export const DWELL_FLOOR_MS = 0.25;
export const DWELL_FLOOR_FRACTION = 0.01;

export function dwellFloorMs(baselineMs: number): number {
  return Math.max(DWELL_FLOOR_MS, DWELL_FLOOR_FRACTION * baselineMs);
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
  const drift = Math.abs(mb - ma) / ma;
  if (drift > BUFFER_MPX_TOLERANCE) {
    return `buffer ${ma} vs ${mb} Mpx (${(drift * 100).toFixed(1)} % apart) — the frame is fill-bound`;
  }
  return recordCountRefusal(a.recordCount, b.recordCount);
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
  const drift = a === b ? 0 : Math.abs(b - a) / a;
  if (drift > RECORD_COUNT_TOLERANCE) {
    return `catalogue ${a} vs ${b} records (${(drift * 100).toFixed(1)} % apart) — every star pass draws a different scene`;
  }
  return null;
}

function verdictFor(deltaMs: number, bandMs: number): Verdict {
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
function dwellRow(key: string, a: ScenarioRecord, b: ScenarioRecord): DiffRow | DiffRefusal {
  const [da, db] = [a.dwell, b.dwell];
  if (da === null || db === null) {
    return { key: `${key}|dwell`, reason: 'one run has no dwell record' };
  }
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
  const deltaMs = cb.p50 - ca.p50;
  const bandMs = band(medianStandardErrorMs(ca), medianStandardErrorMs(cb), dwellFloorMs(ca.p50));
  return {
    key: `${key}|dwell`,
    metric: ga.metric,
    baselineMs: ca.p50,
    currentMs: cb.p50,
    deltaMs,
    bandMs,
    verdict: verdictFor(deltaMs, bandMs),
  };
}

/**
 * Difference `current` against `baseline`. Refusals are the point of this
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
      const outcome = dwellRow(key, a, b);
      if ('reason' in outcome) refusals.push(outcome);
      else rows.push(outcome);
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
