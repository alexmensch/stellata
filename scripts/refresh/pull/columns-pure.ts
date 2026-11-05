// A pulled table's columns: the ADQL projection, the reply's schema check, and the TSV it writes. See README.md#columns.

import { tsvCell } from '../../util/tsv/artifact-pure';
import type { TapResult } from './tap-pure';

export interface Column {
  /** The header the archive answers with and the TSV writes. */
  readonly name: string;
  /** The projection, when it is not `name` itself: a qualified column or an aliased expression answering as `name`. */
  readonly select?: string;
  /** Applied to every non-empty cell before it is written. */
  readonly format?: (cell: string) => string;
}

export type Row = TapResult['rows'][number];
export type Cell = (column: string) => string | null;

export function projection(columns: readonly Column[], quote: (identifier: string) => string): string {
  return columns.map((c) => c.select ?? quote(c.name)).join(', ');
}

/** Refuses a reply whose header is not exactly `columns`, in order. */
export function checkedRows(columns: readonly Column[], result: TapResult, label: string): readonly Row[] {
  const want = columns.map((c) => c.name);
  if (want.length !== result.columns.length || want.some((name, i) => name !== result.columns[i])) {
    throw new Error(`${label}: the reply's columns [${result.columns.join(', ')}] are not the declared [${want.join(', ')}]`);
  }
  return result.rows;
}

export function cellReader(columns: readonly Column[], label: string): (row: Row) => Cell {
  const index = new Map(columns.map((c, i) => [c.name, i]));
  return (row) => (column) => {
    const i = index.get(column);
    if (i === undefined) throw new Error(`${label}: no column ${column}`);
    return row[i];
  };
}

export function formatTsv(file: string, columns: readonly Column[], rows: readonly Row[]): string {
  const lines = rows.map((row) => columns.map((c, i) => {
    const cell = row[i];
    return tsvCell(file, c.name, cell === null ? '' : c.format ? c.format(cell) : cell);
  }).join('\t'));
  return `${[columns.map((c) => c.name).join('\t'), ...lines].join('\n')}\n`;
}
