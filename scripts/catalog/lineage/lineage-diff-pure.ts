// The run-to-run diff: a merge-join of two key-sorted lineage files, and its TSV form. See README.md#run-to-run-diff.

import {
  LINEAGE_COLUMNS, compareLineageRows, compareUtf8, encodeLineageLine, lineageLineKey, utf8Lines,
  type LineageRow,
} from './lineage-row-pure';

export type KeyChangeKind = 'added' | 'removed' | 'changed';

export interface KeyChange<T = LineageRow> {
  readonly kind: KeyChangeKind;
  readonly key: string;
  /** Rows under the key in the baseline that the current file lacks. */
  readonly removed: readonly T[];
  /** Rows under the key in the current file that the baseline lacks. */
  readonly added: readonly T[];
}

/** How the diff reads one lineage row, held either as a LineageRow or as its line. */
export interface LineageForm<T> {
  key(row: T): string;
  line(row: T): string;
  compare(a: T, b: T): number;
}

export const ROW_FORM: LineageForm<LineageRow> = {
  key: (row) => row.key, line: encodeLineageLine, compare: compareLineageRows,
};

export const LINE_FORM: LineageForm<string> = {
  key: lineageLineKey, line: (line) => line, compare: compareUtf8,
};

function* keyGroups<T>(rows: Iterable<T>, side: string, form: LineageForm<T>): Generator<T[]> {
  let group: T[] = [];
  let prev: T | null = null;
  let prevKey = '';
  for (const row of rows) {
    const key = form.key(row);
    if (prev !== null && form.compare(prev, row) > 0) {
      throw new Error(`lineage: the diff's ${side} file is not in lineage order at key ${key}`);
    }
    if (prev !== null && prevKey !== key) {
      yield group;
      group = [];
    }
    group.push(row);
    prev = row;
    prevKey = key;
  }
  if (group.length > 0) yield group;
}

/** A key's rows diff as a set: changed means the set under one key differs. */
export function diffLineage(baseline: Iterable<LineageRow>, current: Iterable<LineageRow>): KeyChange[] {
  return diffLineageAs(ROW_FORM, baseline, current);
}

export function diffLineageAs<T>(form: LineageForm<T>, baseline: Iterable<T>, current: Iterable<T>): KeyChange<T>[] {
  const before = keyGroups(baseline, 'baseline', form);
  const after = keyGroups(current, 'current', form);
  const changes: KeyChange<T>[] = [];
  let b = before.next();
  let a = after.next();
  while (!b.done || !a.done) {
    const order = b.done ? 1 : a.done ? -1 : compareUtf8(form.key(b.value[0]), form.key(a.value[0]));
    if (order < 0 && !b.done) {
      changes.push({ kind: 'removed', key: form.key(b.value[0]), removed: b.value, added: [] });
      b = before.next();
    } else if (order > 0 && !a.done) {
      changes.push({ kind: 'added', key: form.key(a.value[0]), removed: [], added: a.value });
      a = after.next();
    } else if (!b.done && !a.done) {
      const was = new Set(b.value.map(form.line));
      const now = new Set(a.value.map(form.line));
      const removed = b.value.filter((r) => !now.has(form.line(r)));
      const added = a.value.filter((r) => !was.has(form.line(r)));
      if (removed.length > 0 || added.length > 0) {
        changes.push({ kind: 'changed', key: form.key(b.value[0]), removed, added });
      }
      b = before.next();
      a = after.next();
    }
  }
  return changes;
}

/** A column a stage joins onto each changed key from another stage's facts. */
export interface DiffJoin {
  readonly name: string;
  of(key: string): string;
}

export const DIFF_COLUMNS = ['change', 'side', ...LINEAGE_COLUMNS] as const;

/** One line per row that differs, `-` from the baseline and `+` from the
 *  current build, under its key's change kind. */
export function stageDiffText(
  changes: readonly KeyChange[], joins: readonly DiffJoin[] = [], batch?: number,
): Uint8Array {
  return stageDiffTextAs(ROW_FORM, changes, joins, batch);
}

export function stageDiffTextAs<T>(
  form: LineageForm<T>, changes: readonly KeyChange<T>[], joins: readonly DiffJoin[] = [], batch?: number,
): Uint8Array {
  return utf8Lines([...DIFF_COLUMNS, ...joins.map((j) => j.name)].join('\t'), (function* () {
    for (const change of changes) {
      const joined = joins.map((j) => j.of(change.key));
      for (const [side, rows] of [['-', change.removed], ['+', change.added]] as const) {
        for (const row of rows) yield [change.kind, side, form.line(row), ...joined].join('\t');
      }
    }
  })(), batch);
}
