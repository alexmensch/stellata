// Text tables for everything the runner prints: priceFrame rows in the
// column order console.table shows them in-app, dwell summaries, sweep
// points and the baseline diff.

import { round3, type PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost-pure';
import { VERDICT_MARK, type RunDiff } from './diff-pure';
import type { DwellSummary } from './dwell-pure';
import type { SweepFit, SweepPoint } from './sweep-pure';

export type Cell = string | number | undefined;

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
] as const satisfies readonly (keyof PriceFrameRow)[];

export function formatPriceTable(rows: readonly PriceFrameRow[]): string {
  return formatTable(
    PRICE_ROW_COLUMNS,
    rows.map((row) => PRICE_ROW_COLUMNS.map((column) => row[column])),
  );
}

export const DWELL_COLUMNS = [
  'clock', 'samples', 'p50', 'p90', 'p99', 'iqrMs', 'lag1', 'vsyncClamped',
] as const;

export function formatDwellTable(
  labelled: readonly (readonly [string, DwellSummary])[],
): string {
  return formatTable(
    DWELL_COLUMNS,
    labelled.map(([clock, s]) => [
      clock, s.samples, round3(s.p50), round3(s.p90), round3(s.p99),
      round3(s.iqrMs), round3(s.lag1), String(s.vsyncClamped),
    ]),
  );
}

export const SWEEP_COLUMNS = ['scale', 'width', 'height', 'Mpx', 'ms', 'vsyncClamped'] as const;

export function formatSweepTable(points: readonly SweepPoint[], fit: SweepFit, bracketMs: number): string {
  const table = formatTable(
    SWEEP_COLUMNS,
    points.map((p) => [
      p.scale, p.width, p.height, round3(p.px / 1e6), round3(p.ms), String(p.vsyncClamped),
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

function cellText(value: Cell): string {
  return value === undefined ? '' : String(value);
}
