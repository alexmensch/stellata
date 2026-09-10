// Two perf runs, differenced: which rows moved further than the pair's own
// uncertainty, and which pairs are not comparable at all.
// README.md § Comparing against a baseline.

import { medianStandardErrorMs } from '../../src/client/debug/frame-cost/frame-cost-pure';
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

export type Verdict = 'cheaper' | 'dearer' | 'same';

export const VERDICT_MARK: Record<Verdict, string> = {
  cheaper: '✓',
  dearer: '✗',
  same: '~',
};

export interface DiffRow {
  readonly key: string;
  /** `savedMs` for a differential row, `p50` for a dwell. Both read
   *  upward-is-dearer, which is the trap in `savedMs`: the field names
   *  what disabling the pass saved, i.e. the pass's own price, so a bigger
   *  number is a costlier pass and not a bigger win. */
  readonly metric: 'savedMs' | 'p50';
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

function dwellRow(key: string, a: ScenarioRecord, b: ScenarioRecord): DiffRow | DiffRefusal {
  const [da, db] = [a.dwell, b.dwell];
  if (da === null || db === null) {
    return { key: `${key}|dwell`, reason: 'one run has no dwell record' };
  }
  if (da.stats.vsyncClamped || db.stats.vsyncClamped) {
    return {
      key: `${key}|dwell`,
      reason: 'a dwell was vsync-clamped — it measured the panel, not the frame',
    };
  }
  // Both clocks, where the pin refuses on one: a guard may only stand down on
  // the clock its row does NOT mark, and this row marks on wall p50 (below).
  // README.md § Comparing against a baseline.
  const trending = [da, db].some(
    (d) => d.stats.stateGuard === 'trending' || d.gpuStats?.stateGuard === 'trending',
  );
  if (trending) {
    return {
      key: `${key}|dwell`,
      reason: 'a dwell trended across its quarters — it straddled a load-state transition',
    };
  }
  const deltaMs = db.stats.p50 - da.stats.p50;
  const bandMs = band(medianStandardErrorMs(da.stats), medianStandardErrorMs(db.stats), 0);
  return {
    key: `${key}|dwell`,
    metric: 'p50',
    baselineMs: da.stats.p50,
    currentMs: db.stats.p50,
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
