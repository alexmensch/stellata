// The count comparator every count snapshot check passes. See README.md#comparing-counts.

import { absentStages, flattenStages, stageOfCounts } from './count-stages-pure';

export type CountDiff =
  | { key: string; status: 'match'; value: number }
  | { key: string; status: 'mismatch'; expected: number; actual: number }
  | { key: string; status: 'moved'; value: number; from: string; to: string }
  | { key: string; status: 'absent-from-snapshot'; actual: number }
  | { key: string; status: 'absent-from-build'; expected: number }
  /** A stage one side records as absent (its input was missing) and the other counted; `key` is the stage. */
  | { key: string; status: 'absent-input'; side: 'build' | 'snapshot' };

/** Every row of either side, in the actual object's order, then the snapshot-only ones. See README.md#comparing-counts. */
export function compareBuildCounts<T extends object>(
  expected: T,
  actual: T,
): CountDiff[] {
  const e = flattenCounts(expected);
  const a = flattenCounts(actual);
  const eStage = stageOfCounts(expected);
  const aStage = stageOfCounts(actual);
  const eAbsent = absentStages(expected);
  const aAbsent = absentStages(actual);
  const diff: CountDiff[] = [];
  for (const [key, { n: av, count }] of a) {
    const ev = e.get(key)?.n;
    const from = eStage?.get(count);
    const to = aStage?.get(count);
    if (ev === undefined && to !== undefined && eAbsent.has(to)) continue;
    if (ev === undefined) diff.push({ key, status: 'absent-from-snapshot', actual: av });
    else if (ev !== av) diff.push({ key, status: 'mismatch', expected: ev, actual: av });
    else if (from !== undefined && to !== undefined && from !== to) diff.push({ key, status: 'moved', value: av, from, to });
    else diff.push({ key, status: 'match', value: av });
  }
  for (const [key, { n: ev, count }] of e) {
    const from = eStage?.get(count);
    if (!a.has(key) && !(from !== undefined && aAbsent.has(from))) diff.push({ key, status: 'absent-from-build', expected: ev });
  }
  for (const stage of aAbsent) if (!eAbsent.has(stage)) diff.push({ key: stage, status: 'absent-input', side: 'build' });
  for (const stage of eAbsent) if (!aAbsent.has(stage)) diff.push({ key: stage, status: 'absent-input', side: 'snapshot' });
  return diff;
}

/** Each row with the count it belongs to: a partition's buckets share their parent's. */
function flattenCounts(counts: object): Map<string, { n: number; count: string }> {
  const rows = new Map<string, { n: number; count: string }>();
  for (const [count, value] of Object.entries(flattenStages(counts) as Record<string, unknown>)) {
    if (typeof value === 'number') {
      rows.set(count, { n: value, count });
      continue;
    }
    if (value === null || typeof value !== 'object') {
      throw new Error(`count ${count} is ${JSON.stringify(value)}, not a number or a partition`);
    }
    for (const [bucket, n] of Object.entries(value as Record<string, number>)) {
      rows.set(`${count}.${bucket}`, { n, count });
    }
  }
  return rows;
}

type DriftedRow = Exclude<CountDiff, { status: 'match' }>;

export function driftedRows(diff: CountDiff[]): DriftedRow[] {
  return diff.filter((d): d is DriftedRow => d.status !== 'match');
}

/** Only drifted rows are listed, so a fatal exit doesn't scroll the
 *  actionable ones off-screen. */
export function formatCountDiff(diff: CountDiff[]): string {
  const drifted = driftedRows(diff);
  if (drifted.length === 0) return `build-counts: all ${diff.length} counts match`;
  const width = Math.max(...drifted.map((d) => d.key.length));
  const lines = [`build-counts: ${drifted.length} of ${diff.length} counts differ`];
  for (const d of drifted) {
    const label = `  ${d.key.padEnd(width)}`;
    switch (d.status) {
      case 'absent-from-snapshot':
        lines.push(`${label} absent from snapshot, got ${d.actual}`);
        break;
      case 'absent-from-build':
        lines.push(`${label} expected ${d.expected}, absent from build`);
        break;
      case 'moved':
        lines.push(`${label} ${d.value} moved from stage ${d.from} to ${d.to}`);
        break;
      case 'absent-input':
        lines.push(`${label} stage's input is absent from the ${d.side}, counted in the ${d.side === 'build' ? 'snapshot' : 'build'}`);
        break;
      case 'mismatch': {
        const delta = d.actual - d.expected;
        const sign = delta > 0 ? '+' : '';
        lines.push(`${label} expected ${d.expected}, got ${d.actual} (${sign}${delta})`);
        break;
      }
    }
  }
  return lines.join('\n');
}

/** The `compare` every count snapshot passes to `snapshotCheck`. */
export function compareCountSnapshot<T extends object>(
  expected: T,
  actual: T,
): { drifted: boolean; report: string } {
  const diff = compareBuildCounts(expected, actual);
  return {
    drifted: driftedRows(diff).length > 0,
    report: formatCountDiff(diff),
  };
}
