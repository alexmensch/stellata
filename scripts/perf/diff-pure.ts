// Two perf runs, differenced: which rows moved further than the pair's own
// uncertainty, and which pairs are not comparable at all.
// README.md § Comparing against a baseline.

import { medianStandardErrorMs } from '../../src/client/debug/frame-cost/frame-cost-pure';
import type { PerfFile, ScenarioRecord } from './schema';

/** How far the two buffers may differ and still be compared. Both dominant
 *  passes scale with area, so a resized window is a different measurement
 *  wearing the same row label. */
export const BUFFER_MPX_TOLERANCE = 0.01;

/** A row has to move further than this multiple of the pair's combined
 *  standard error to count. Two sigma either side, not one: a one-sigma
 *  band calls roughly a third of unchanged rows a regression. */
const BAND_SIGMAS = 2;

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
  return null;
}

function verdictFor(deltaMs: number, bandMs: number): Verdict {
  if (Math.abs(deltaMs) <= bandMs) return 'same';
  return deltaMs < 0 ? 'cheaper' : 'dearer';
}

function band(seA: number, seB: number, floorMs: number): number {
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
 * schema suffix before anything is read as v1 — so the schema is settled by
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
