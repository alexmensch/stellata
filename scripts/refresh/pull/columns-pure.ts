// A pulled table's columns: the ADQL projection, the reply's schema check, and the TSV it writes. See README.md#columns.

import { formatFixed } from '../../util/round-pure';
import { nullableCell, tsvLine, tsvText } from '../../util/tsv/artifact-pure';
import type { TapResult } from './tap-pure';

/** Python's `f"{x:.{fixed}f}"`, the rounding every pull writes with today. */
export interface Format {
  readonly fixed: number;
}

export interface Column {
  /** The header the archive answers with and the TSV writes. */
  readonly name: string;
  /** The projection, when it is not `name` itself: a qualified column or an aliased expression answering as `name`. */
  readonly select?: string;
  readonly format?: Format;
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

function columnIndex(columns: readonly Column[], label: string): (column: string) => number {
  const index = new Map(columns.map((c, i) => [c.name, i]));
  return (column) => {
    const i = index.get(column);
    if (i === undefined) throw new Error(`${label}: no column ${column}`);
    return i;
  };
}

export function cellReader(columns: readonly Column[], label: string): (row: Row) => Cell {
  const at = columnIndex(columns, label);
  return (row) => (column) => row[at(column)];
}

function formatted(file: string, column: Column, cell: string | null): string {
  if (cell === null || column.format === undefined) return nullableCell(cell);
  const value = Number(cell);
  if (!Number.isFinite(value)) throw new Error(`${file}: ${column.name}="${cell}" has a numeric format but is not a number`);
  return formatFixed(value, column.format.fixed);
}

export function formatTsv(file: string, columns: readonly Column[], rows: readonly Row[]): string {
  const names = columns.map((c) => c.name);
  return tsvText(names, rows.map((row) => tsvLine(file, names, columns.map((c, i) => formatted(file, c, row[i])))));
}
