// A pulled table's columns: the ADQL projection, the reply's schema check, the write order, and the TSV it writes. See README.md#columns.

import { formatExponent, formatFixed } from '../../util/round-pure';
import { nullableCell, tsvLine, tsvText } from '../../util/tsv/artifact-pure';
import type { TapResult } from './tap-pure';

/** See README.md#columns. */
export type Format =
  | { readonly fixed: number; readonly float32?: true }
  | { readonly exp: number; readonly float32?: true }
  | { readonly flag: true };

const FLAG_TEXT: Readonly<Record<string, '0' | '1'>> = { 0: '0', 1: '1', false: '0', true: '1' };

export interface Column {
  /** The header the archive answers with and the TSV writes. */
  readonly name: string;
  /** The projection, when it is not `name` itself: a qualified column or an aliased expression answering as `name`. */
  readonly select?: string;
  readonly format?: Format;
}

/** How a column's text compares: `integer` exactly at any size (a source_id), `decimal` as a double. */
export interface SortKey {
  readonly column: string;
  readonly as: 'integer' | 'decimal' | 'text';
}

export type Row = TapResult['rows'][number];
export type Cell = (column: string) => string | null;

export function projection(columns: readonly Column[], quote: (identifier: string) => string): string {
  return columns.map((c) => c.select ?? quote(c.name)).join(', ');
}

function flagCell(label: string, column: string, cell: string | null): string | null {
  if (cell === null) return null;
  if (!Object.hasOwn(FLAG_TEXT, cell)) throw new Error(`${label}: ${column}="${cell}" is not a two-valued flag (0/1 or false/true)`);
  return FLAG_TEXT[cell];
}

/** Refuses a reply whose header is not exactly `columns`, in order; a flag column's cells come back `0`/`1`, whichever mirror answered. */
export function checkedRows(columns: readonly Column[], result: TapResult, label: string): readonly Row[] {
  const want = columns.map((c) => c.name);
  if (want.length !== result.columns.length || want.some((name, i) => name !== result.columns[i])) {
    throw new Error(`${label}: the reply's columns [${result.columns.join(', ')}] are not the declared [${want.join(', ')}]`);
  }
  const flags = columns.flatMap((c, i) => (c.format !== undefined && 'flag' in c.format ? [i] : []));
  if (flags.length === 0) return result.rows;
  return result.rows.map((row) => row.map((cell, i) => (flags.includes(i) ? flagCell(label, want[i], cell) : cell)));
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

const COMPARE: Record<SortKey['as'], (a: string, b: string) => number> = {
  integer: (a, b) => { const d = BigInt(a) - BigInt(b); return d < 0n ? -1 : d > 0n ? 1 : 0; },
  decimal: (a, b) => Number(a) - Number(b),
  text: (a, b) => (a < b ? -1 : a > b ? 1 : 0),
};

/** Every row, across batches, in `keys` order; an empty cell sorts first. */
export function sortRows(columns: readonly Column[], rows: readonly Row[], keys: readonly SortKey[], label: string): Row[] {
  const at = columnIndex(columns, label);
  const steps = keys.map((k) => ({ i: at(k.column), compare: COMPARE[k.as] }));
  return [...rows].sort((a, b) => {
    for (const { i, compare } of steps) {
      const x = a[i];
      const y = b[i];
      const d = x === y ? 0 : x === null ? -1 : y === null ? 1 : compare(x, y);
      if (d !== 0) return d;
    }
    return 0;
  });
}

function formatted(file: string, column: Column, cell: string | null): string {
  if (cell === null || column.format === undefined) return nullableCell(cell);
  const { format } = column;
  if ('flag' in format) return cell;
  const parsed = Number(cell);
  if (!Number.isFinite(parsed)) throw new Error(`${file}: ${column.name}="${cell}" has a numeric format but is not a number`);
  const value = format.float32 ? Math.fround(parsed) : parsed;
  return 'fixed' in format ? formatFixed(value, format.fixed) : formatExponent(value, format.exp);
}

export function formatTsv(file: string, columns: readonly Column[], rows: readonly Row[]): string {
  const names = columns.map((c) => c.name);
  return tsvText(names, rows.map((row) => tsvLine(file, names, columns.map((c, i) => formatted(file, c, row[i])))));
}
