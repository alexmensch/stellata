// The run-to-run diff: a merge-join of two key-sorted lineage files, and its TSV form. See README.md#run-to-run-diff.

import {
  LINEAGE_COLUMNS, compareLineageRows, compareUtf8, encodeLineageLine, utf8Lines, type LineageRow,
} from './lineage-row-pure';

export type KeyChangeKind = 'added' | 'removed' | 'changed';

export interface KeyChange {
  readonly kind: KeyChangeKind;
  readonly key: string;
  /** Rows under the key in the baseline that the current file lacks. */
  readonly removed: readonly LineageRow[];
  /** Rows under the key in the current file that the baseline lacks. */
  readonly added: readonly LineageRow[];
}

function* keyGroups(rows: Iterable<LineageRow>, side: string): Generator<LineageRow[]> {
  let group: LineageRow[] = [];
  let prev: LineageRow | null = null;
  for (const row of rows) {
    if (prev !== null && compareLineageRows(prev, row) > 0) {
      throw new Error(`lineage: the diff's ${side} file is not in lineage order at key ${row.key}`);
    }
    if (prev !== null && prev.key !== row.key) {
      yield group;
      group = [];
    }
    group.push(row);
    prev = row;
  }
  if (group.length > 0) yield group;
}

/** A key's rows diff as a set: changed means the set under one key differs. */
export function diffLineage(baseline: Iterable<LineageRow>, current: Iterable<LineageRow>): KeyChange[] {
  const before = keyGroups(baseline, 'baseline');
  const after = keyGroups(current, 'current');
  const changes: KeyChange[] = [];
  let b = before.next();
  let a = after.next();
  while (!b.done || !a.done) {
    const order = b.done ? 1 : a.done ? -1 : compareUtf8(b.value[0].key, a.value[0].key);
    if (order < 0 && !b.done) {
      changes.push({ kind: 'removed', key: b.value[0].key, removed: b.value, added: [] });
      b = before.next();
    } else if (order > 0 && !a.done) {
      changes.push({ kind: 'added', key: a.value[0].key, removed: [], added: a.value });
      a = after.next();
    } else if (!b.done && !a.done) {
      const was = new Set(b.value.map(encodeLineageLine));
      const now = new Set(a.value.map(encodeLineageLine));
      const removed = b.value.filter((r) => !now.has(encodeLineageLine(r)));
      const added = a.value.filter((r) => !was.has(encodeLineageLine(r)));
      if (removed.length > 0 || added.length > 0) {
        changes.push({ kind: 'changed', key: b.value[0].key, removed, added });
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
  return utf8Lines([...DIFF_COLUMNS, ...joins.map((j) => j.name)].join('\t'), (function* () {
    for (const change of changes) {
      const joined = joins.map((j) => j.of(change.key));
      for (const [side, rows] of [['-', change.removed], ['+', change.added]] as const) {
        for (const row of rows) yield [change.kind, side, encodeLineageLine(row), ...joined].join('\t');
      }
    }
  })(), batch);
}
