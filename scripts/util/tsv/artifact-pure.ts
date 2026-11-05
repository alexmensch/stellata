// A self-written TSV's codec: exact header, one decoder for its readers, and
// one serializer as its only writer. See README.md#artifact-codecs.

import type { Declaration, RowKey, RowKeyOf } from '../sources/row-ref-pure';
import {
  readTable, tableLineReader, type TableLineReader, type TableRow, type TableSpec,
} from './table-pure';

export function nullableCell(v: string | number | null): string {
  return v === null ? '' : String(v);
}

export function tsvLine(file: string, columns: readonly string[], cells: readonly string[]): string {
  return columns.map((column, i) => {
    const cell = cells[i];
    if (/[\t\n\r]/.test(cell)) throw new Error(`${file}: cell ${column}="${cell}" contains a TSV delimiter`);
    return cell;
  }).join('\t');
}

export function tsvText(columns: readonly string[], lines: readonly string[]): string {
  return `${[columns.join('\t'), ...lines].join('\n')}\n`;
}

/** Code-unit order: the same on every machine, unlike `localeCompare`. */
export function byText<R>(text: (r: R) => string): (a: R, b: R) => number {
  return (a, b) => (text(a) < text(b) ? -1 : text(a) > text(b) ? 1 : 0);
}

/** `by-line` sorts the encoded lines; `as-given` keeps the caller's order. */
export type ArtifactOrder<R> = 'by-line' | 'as-given' | ((a: R, b: R) => number);

export interface ArtifactSpec<C extends string, R, K = never> {
  readonly file: string;
  readonly columns: readonly C[];
  readonly hint: string;
  readonly order: ArtifactOrder<R>;
  readonly rowKey?: RowKey<K>;
  decode(row: TableRow<C>): R;
  encode(record: R): Readonly<Record<C, string>>;
}

export interface Artifact<C extends string, R, K = never>
  extends Omit<ArtifactSpec<C, R, K>, 'rowKey'>, Declaration {
  readonly kind: 'artifact';
  readonly rowKey: RowKeyOf<K>;
  readonly table: TableSpec<C>;
  rows(text: string): Generator<R>;
  parse(text: string): R[];
  lineReader(onRecord: (record: R) => void): TableLineReader;
  /** One record's data line, without its newline: what an append writes. */
  encodeLine(record: R): string;
  serialize(records: readonly R[]): string;
}

export function defineArtifact<C extends string, R, K = never>(
  spec: ArtifactSpec<C, R, K>,
): Artifact<C, R, K> {
  const table: TableSpec<C> = { file: spec.file, columns: spec.columns, hint: spec.hint, exact: true };

  const encodeLine = (record: R): string => {
    const cells = spec.encode(record);
    return tsvLine(spec.file, spec.columns, spec.columns.map((c) => cells[c]));
  };

  function* rows(text: string): Generator<R> {
    for (const row of readTable(table, text)) yield spec.decode(row);
  }

  return {
    ...spec,
    kind: 'artifact',
    rowKey: spec.rowKey as RowKeyOf<K>,
    table,
    rows,
    parse: (text) => [...rows(text)],
    lineReader: (onRecord) => tableLineReader(table, (row) => onRecord(spec.decode(row))),
    encodeLine,
    serialize(records) {
      const { order } = spec;
      const sorted = typeof order === 'function' ? [...records].sort(order) : records;
      const lines = sorted.map(encodeLine);
      if (order === 'by-line') lines.sort();
      return tsvText(spec.columns, lines);
    },
  } as Artifact<C, R, K>;
}
