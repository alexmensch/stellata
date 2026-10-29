// The run-to-run diff: a merge-join of two key-sorted lineage files, and its TSV form. See README.md#run-to-run-diff.

import {
  LINEAGE_COLUMNS, compareLineageRows, compareUtf8, encodeLineageLine, type LineageRow,
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

function keyGroups(rows: readonly LineageRow[], side: string): LineageRow[][] {
  const groups: LineageRow[][] = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && compareLineageRows(rows[i - 1], rows[i]) > 0) {
      throw new Error(`lineage diff: the ${side} file is not in lineage order at key ${rows[i].key}`);
    }
    if (i > 0 && rows[i - 1].key === rows[i].key) groups[groups.length - 1].push(rows[i]);
    else groups.push([rows[i]]);
  }
  return groups;
}

/** A key's rows diff as a set: changed means the set under one key differs. */
export function diffLineage(baseline: readonly LineageRow[], current: readonly LineageRow[]): KeyChange[] {
  const before = keyGroups(baseline, 'baseline');
  const after = keyGroups(current, 'current');
  const changes: KeyChange[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    const order = i === before.length ? 1 : j === after.length ? -1 : compareUtf8(before[i][0].key, after[j][0].key);
    if (order < 0) {
      changes.push({ kind: 'removed', key: before[i][0].key, removed: before[i], added: [] });
      i++;
    } else if (order > 0) {
      changes.push({ kind: 'added', key: after[j][0].key, removed: [], added: after[j] });
      j++;
    } else {
      const was = new Set(before[i].map(encodeLineageLine));
      const now = new Set(after[j].map(encodeLineageLine));
      const removed = before[i].filter((r) => !now.has(encodeLineageLine(r)));
      const added = after[j].filter((r) => !was.has(encodeLineageLine(r)));
      if (removed.length > 0 || added.length > 0) {
        changes.push({ kind: 'changed', key: before[i][0].key, removed, added });
      }
      i++;
      j++;
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
export function stageDiffText(changes: readonly KeyChange[], joins: readonly DiffJoin[] = []): string {
  const lines = [[...DIFF_COLUMNS, ...joins.map((j) => j.name)].join('\t')];
  for (const change of changes) {
    const joined = joins.map((j) => j.of(change.key));
    for (const [side, rows] of [['-', change.removed], ['+', change.added]] as const) {
      for (const row of rows) {
        lines.push([change.kind, side, encodeLineageLine(row), ...joined].join('\t'));
      }
    }
  }
  return `${lines.join('\n')}\n`;
}
