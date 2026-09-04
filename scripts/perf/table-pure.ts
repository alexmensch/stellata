// Text rendering of priceFrame rows, in the column order console.table
// shows them in-app.

import type { PriceFrameRow } from '../../src/client/debug/frame-cost/frame-cost-pure';

export const PRICE_ROW_COLUMNS = [
  'pass', 'method', 'baselineMs', 'disabledMs', 'savedMs', 'savedPct', 'samples',
  'iqrMs', 'noiseMs', 'bracketMs', 'baselineLag1', 'disabledLag1',
  'baselineReadback', 'disabledReadback', 'baselineLimitMag', 'disabledLimitMag', 'bufferMpx',
] as const satisfies readonly (keyof PriceFrameRow)[];

export function formatPriceTable(rows: readonly PriceFrameRow[]): string {
  const cells = rows.map((row) => PRICE_ROW_COLUMNS.map((column) => cellText(row[column])));
  const widths = PRICE_ROW_COLUMNS.map((column, i) =>
    Math.max(column.length, ...cells.map((row) => row[i].length)));
  const line = (xs: readonly string[]) => xs.map((x, i) => x.padStart(widths[i])).join('  ');
  return [line(PRICE_ROW_COLUMNS), ...cells.map(line)].join('\n');
}

function cellText(value: string | number | undefined): string {
  return value === undefined ? '' : String(value);
}
