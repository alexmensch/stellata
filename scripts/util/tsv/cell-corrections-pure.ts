// See README.md#cell-corrections.

import type { TableRow } from './table-pure';

export interface CellSet<C extends string> {
  readonly key: string;
  readonly cell: C;
  readonly value: string;
}

export interface CorrectedTable<R, C extends string> {
  /** The corrections file, which every error names. */
  readonly file: string;
  /** What the corrected rows are, as an error reads it: "spine". */
  readonly target: string;
  keyOf(row: R): string;
  get(row: R, cell: C): string;
  with(row: R, cell: C, value: string): R;
}

export function applyCellSets<R, C extends string>(
  rows: readonly R[],
  sets: readonly CellSet<C>[],
  table: CorrectedTable<R, C>,
): R[] {
  const byKey = new Map<string, number>();
  rows.forEach((row, i) => byKey.set(table.keyOf(row), i));
  const out = rows.slice();
  for (const s of sets) {
    const i = byKey.get(s.key);
    if (i === undefined) throw new Error(`${table.file}: row "${s.key}" matches no ${table.target} row`);
    if (table.get(out[i], s.cell) === s.value) {
      throw new Error(
        `${table.file}: row ${s.key} sets ${s.cell} to the value the ${table.target} already states; remove it`,
      );
    }
    out[i] = table.with(out[i], s.cell, s.value);
  }
  return out;
}

export function evidenceOf<C extends string>(row: TableRow<C>, column: C, key: string): string {
  return row.text(column) ?? row.fail(`row ${key} states no evidence`);
}
