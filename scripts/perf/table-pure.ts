// Text tables for everything the runner prints: priceFrame rows in the
// column order console.table shows them in-app, dwell summaries, sweep
// points and the baseline diff.

import { round3, type PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { VERDICT_MARK, type RunDiff } from './diff-pure';
import { PASS_COUNTERS, type DwellSummary, type PassCountsSummary } from './dwell-pure';
import { PIN_VERDICT_MARK, type PinDiff } from './pin-pure';
import type { DwellRecord } from './schema';
import type { SweepFit, SweepPoint } from './sweep-pure';

export type Cell = string | number | boolean | undefined;

export function formatTable(
  columns: readonly string[],
  rows: readonly (readonly Cell[])[],
): string {
  const cells = rows.map((row) => row.map(cellText));
  const widths = columns.map((column, i) =>
    Math.max(column.length, ...cells.map((row) => (row[i] ?? '').length)));
  const line = (xs: readonly string[]): string =>
    xs.map((x, i) => x.padStart(widths[i])).join('  ');
  return [line(columns), ...cells.map(line)].join('\n');
}

export const PRICE_ROW_COLUMNS = [
  'pass', 'method', 'baselineMs', 'disabledMs', 'savedMs', 'savedPct', 'samples',
  'iqrMs', 'noiseMs', 'bracketMs', 'baselineLag1', 'disabledLag1',
  'baselineReadback', 'disabledReadback', 'baselineLimitMag', 'disabledLimitMag', 'bufferMpx',
  'cadenceBound',
] as const satisfies readonly (keyof PriceFrameRow)[];

/** A column no row carries is dropped rather than printed empty: on a GPU
 *  clock `cadenceBound` is absent from every row, and a non-interleaved
 *  sweep has no `bracketMs` on any. */
export function formatPriceTable(rows: readonly PriceFrameRow[]): string {
  const columns = rows.length === 0
    ? PRICE_ROW_COLUMNS
    : PRICE_ROW_COLUMNS.filter((column) => rows.some((row) => row[column] !== undefined));
  return formatTable(columns, rows.map((row) => columns.map((column) => row[column])));
}

export const DWELL_COLUMNS = [
  'clock', 'samples', 'p50', 'p90', 'p99', 'iqrMs', 'lag1', 'vsyncClamped', 'stateGuard',
] as const;

export function formatDwellTable(
  labelled: readonly (readonly [string, DwellSummary])[],
): string {
  return formatTable(
    DWELL_COLUMNS,
    labelled.map(([clock, s]) => [
      clock, s.samples, round3(s.p50), round3(s.p90), round3(s.p99),
      round3(s.iqrMs), round3(s.lag1), s.vsyncClamped, s.stateGuard,
    ]),
  );
}

export const PASS_COUNT_COLUMNS = ['perFrame', 'min', 'p50', 'max'] as const;

export function formatPassCountTable(summary: PassCountsSummary): string {
  return formatTable(
    PASS_COUNT_COLUMNS,
    PASS_COUNTERS.map((counter) => {
      const s = summary[counter];
      return [counter, s.min, s.p50, s.max];
    }),
  );
}

/** The second dwell against the first, both clocks, as ratios — absolute
 *  milliseconds do not reproduce, ratios at one buffer and one clock do. */
export function formatRoundTripLine(pass: string, before: DwellRecord, after: DwellRecord): string {
  const ratio = (a: number, b: number): string => `${round3(a)} → ${round3(b)} (×${(b / a).toFixed(3)})`;
  const parts = [`round trip ${pass}: raf p50 ${ratio(before.stats.p50, after.stats.p50)}`];
  if (before.gpuStats !== null && after.gpuStats !== null) {
    parts.push(`gpu p50 ${ratio(before.gpuStats.p50, after.gpuStats.p50)}`);
  }
  parts.push(`limit ${round3(before.limitMag)} → ${round3(after.limitMag)} mag`);
  parts.push(`dm ${round3(before.dm)} → ${round3(after.dm)}`);
  return parts.join(' · ');
}

export const SWEEP_COLUMNS = ['scale', 'width', 'height', 'Mpx', 'ms', 'vsyncClamped'] as const;

export function formatSweepTable(points: readonly SweepPoint[], fit: SweepFit, bracketMs: number): string {
  const table = formatTable(
    SWEEP_COLUMNS,
    points.map((p) => [
      p.scale, p.width, p.height, round3(p.px / 1e6), round3(p.ms), p.vsyncClamped,
    ]),
  );
  return `${table}\nslope ${fit.slope.toFixed(3)} · r² ${fit.r2.toFixed(3)} · ` +
    `bound ${fit.bound} · sweep bracket ${bracketMs.toFixed(3)} ms`;
}

export const DIFF_COLUMNS = ['', 'row', 'metric', 'baseline', 'current', 'delta', 'band'] as const;

export function formatDiffTable(diff: RunDiff): string {
  if (diff.refusedWholeRun !== null) {
    return `baseline: REFUSED — ${diff.refusedWholeRun}`;
  }
  const parts: string[] = [];
  if (diff.rows.length > 0) {
    parts.push(formatTable(
      DIFF_COLUMNS,
      diff.rows.map((row) => [
        VERDICT_MARK[row.verdict], row.key, row.metric,
        round3(row.baselineMs), round3(row.currentMs), round3(row.deltaMs), round3(row.bandMs),
      ]),
    ));
  }
  for (const refusal of diff.refusals) {
    parts.push(`  not compared: ${refusal.key} — ${refusal.reason}`);
  }
  return parts.length > 0 ? parts.join('\n') : 'baseline: nothing comparable in either run';
}

export const PIN_DIFF_COLUMNS = ['', 'row', 'metric', 'pinned', 'current', 'delta', 'band', 'note'] as const;

export function formatPinTable(diff: PinDiff): string {
  if (diff.refusedWholeRun !== null) {
    return `pin: REFUSED — ${diff.refusedWholeRun}`;
  }
  const parts: string[] = [];
  if (diff.rows.length > 0) {
    parts.push(formatTable(
      PIN_DIFF_COLUMNS,
      diff.rows.map((row) => [
        PIN_VERDICT_MARK[row.verdict], row.key, row.metric,
        round3(row.pinnedMs), round3(row.currentMs), round3(row.deltaMs), round3(row.bandMs), row.note,
      ]),
    ));
  }
  for (const refusal of diff.refusals) {
    parts.push(`  not compared: ${refusal.key} — ${refusal.reason}`);
  }
  return parts.length > 0 ? parts.join('\n') : 'pin: nothing comparable';
}

function cellText(value: Cell): string {
  return value === undefined ? '' : String(value);
}
