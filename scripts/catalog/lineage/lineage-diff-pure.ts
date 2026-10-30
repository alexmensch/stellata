// The run-to-run diff: a merge-join of two key-sorted lineage files, and its TSV form. See README.md#run-to-run-diff.

import {
  LINEAGE_COLUMNS, compareUtf8, lineageLineKey, utf8Lines, type LineageLine,
} from './lineage-row-pure';

export type KeyChangeKind = 'added' | 'removed' | 'changed';

export interface KeyChange {
  readonly kind: KeyChangeKind;
  readonly key: string;
  /** Lines under the key in the baseline that the current file lacks. */
  readonly removed: readonly LineageLine[];
  /** Lines under the key in the current file that the baseline lacks. */
  readonly added: readonly LineageLine[];
}

function* keyGroups(lines: Iterable<LineageLine>, side: string): Generator<{ key: string; lines: LineageLine[] }> {
  let group: LineageLine[] = [];
  let prev: LineageLine | null = null;
  let prevKey = '';
  for (const line of lines) {
    const key = lineageLineKey(line);
    if (prev !== null && compareUtf8(prev, line) > 0) {
      throw new Error(`lineage: the diff's ${side} file is not in lineage order at key ${key}`);
    }
    if (prev !== null && prevKey !== key) {
      yield { key: prevKey, lines: group };
      group = [];
    }
    group.push(line);
    prev = line;
    prevKey = key;
  }
  if (group.length > 0) yield { key: prevKey, lines: group };
}

/** A key's lines diff as a set: changed means the set under one key differs. */
export function diffLineage(baseline: Iterable<LineageLine>, current: Iterable<LineageLine>): KeyChange[] {
  const before = keyGroups(baseline, 'baseline');
  const after = keyGroups(current, 'current');
  const changes: KeyChange[] = [];
  let b = before.next();
  let a = after.next();
  while (!b.done || !a.done) {
    const order = b.done ? 1 : a.done ? -1 : compareUtf8(b.value.key, a.value.key);
    if (order < 0 && !b.done) {
      changes.push({ kind: 'removed', key: b.value.key, removed: b.value.lines, added: [] });
      b = before.next();
    } else if (order > 0 && !a.done) {
      changes.push({ kind: 'added', key: a.value.key, removed: [], added: a.value.lines });
      a = after.next();
    } else if (!b.done && !a.done) {
      const was = new Set(b.value.lines);
      const now = new Set(a.value.lines);
      const removed = b.value.lines.filter((l) => !now.has(l));
      const added = a.value.lines.filter((l) => !was.has(l));
      if (removed.length > 0 || added.length > 0) {
        changes.push({ kind: 'changed', key: b.value.key, removed, added });
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
      for (const [side, lines] of [['-', change.removed], ['+', change.added]] as const) {
        for (const line of lines) yield [change.kind, side, line, ...joined].join('\t');
      }
    }
  })(), batch);
}
