// A self-written TSV's codec: exact header, one decoder for its readers, and
// one serializer as its only writer. See README.md#artifact-codecs.

import { readTable, tableLineReader, type TableRow, type TableSpec } from './table-pure';

/** `by-line` sorts the encoded lines; `as-given` keeps the caller's order. */
export type ArtifactOrder<R> = 'by-line' | 'as-given' | ((a: R, b: R) => number);

export interface ArtifactSpec<C extends string, R> {
  readonly file: string;
  readonly columns: readonly C[];
  readonly hint: string;
  readonly order: ArtifactOrder<R>;
  decode(row: TableRow<C>): R;
  encode(record: R): Readonly<Record<C, string>>;
}

export interface Artifact<C extends string, R> extends ArtifactSpec<C, R> {
  readonly table: TableSpec<C>;
  rows(text: string): Generator<R>;
  parse(text: string): R[];
  lineReader(onRecord: (record: R) => void): (line: string) => void;
  serialize(records: readonly R[]): string;
}

export function defineArtifact<C extends string, R>(spec: ArtifactSpec<C, R>): Artifact<C, R> {
  const table: TableSpec<C> = { file: spec.file, columns: spec.columns, hint: spec.hint, exact: true };

  const encodeLine = (record: R): string => {
    const cells = spec.encode(record);
    return spec.columns.map((c) => {
      const cell = cells[c];
      if (/[\t\n\r]/.test(cell)) {
        throw new Error(`${spec.file}: cell ${c}="${cell}" contains a TSV delimiter`);
      }
      return cell;
    }).join('\t');
  };

  function* rows(text: string): Generator<R> {
    for (const row of readTable(table, text)) yield spec.decode(row);
  }

  return {
    ...spec,
    table,
    rows,
    parse: (text) => [...rows(text)],
    lineReader: (onRecord) => tableLineReader(table, (row) => onRecord(spec.decode(row))),
    serialize(records) {
      const { order } = spec;
      const sorted = typeof order === 'function' ? [...records].sort(order) : records;
      const lines = sorted.map(encodeLine);
      if (order === 'by-line') lines.sort();
      return `${[spec.columns.join('\t'), ...lines].join('\n')}\n`;
    },
  };
}
