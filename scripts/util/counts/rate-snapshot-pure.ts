// A staged rates snapshot: each rate with its tolerance, the refresh and the compare. See README.md (rate-snapshot-pure.ts entry).

import { flattenStages, stageOfCounts, type StagedCounts } from './count-stages-pure';

/** The snapshot stores each rate rounded to this many decimals. */
export const RATE_SNAPSHOT_DECIMALS = 6;

/** The tolerance a rate takes when the committed snapshot gives it none. */
export const DEFAULT_RATE_TOLERANCE = 0.2;

export interface RateEntry {
  readonly value: number;
  readonly tolerance: number;
}

export type RateSnapshot = StagedCounts<RateEntry>;

const rounded = (value: number): number => Number(value.toFixed(RATE_SNAPSHOT_DECIMALS));

/** Each rate unrounded, under `DEFAULT_RATE_TOLERANCE`: the actual side of the compare. */
export function rateEntries(rates: StagedCounts<number>): RateSnapshot {
  return {
    stages: Object.fromEntries(Object.entries(rates.stages).map(([stage, block]) => [
      stage,
      Object.fromEntries(Object.entries(block).map(([key, value]) => [key, { value, tolerance: DEFAULT_RATE_TOLERANCE }])),
    ])),
  };
}

/** The snapshot a refresh writes: each value rounded, each tolerance the committed one's where it has the rate. */
export function refreshedRates(committed: RateSnapshot | null, actual: RateSnapshot): RateSnapshot {
  const tolerances = new Map(Object.entries(committed === null ? {} : (flattenStages(committed) as Record<string, RateEntry>))
    .map(([key, entry]) => [key, entry.tolerance]));
  return {
    stages: Object.fromEntries(Object.entries(actual.stages).map(([stage, block]) => [
      stage,
      Object.fromEntries(Object.entries(block).map(([key, { value, tolerance }]) => [
        key, { value: rounded(value), tolerance: tolerances.get(key) ?? tolerance },
      ])),
    ])),
  };
}

export type RateDiff =
  | { readonly key: string; readonly status: 'match' | 'drift'; readonly expected: RateEntry; readonly actual: number }
  | { readonly key: string; readonly status: 'moved'; readonly actual: number; readonly from: string; readonly to: string }
  | { readonly key: string; readonly status: 'absent-from-snapshot'; readonly actual: number }
  | { readonly key: string; readonly status: 'absent-from-build'; readonly expected: RateEntry };

/** A rate within `|actual − value| / max(|value|, 1e-9) ≤ tolerance` of the committed one matches, over the union of both sides' keys. */
export function compareRates(expected: RateSnapshot, actual: RateSnapshot): RateDiff[] {
  const e = flattenStages(expected) as Record<string, RateEntry>;
  const a = flattenStages(actual) as Record<string, RateEntry>;
  const eStage = stageOfCounts(expected);
  const aStage = stageOfCounts(actual);
  const diff: RateDiff[] = [];
  for (const [key, { value }] of Object.entries(a)) {
    const committed = e[key];
    const from = eStage?.get(key);
    const to = aStage?.get(key);
    if (committed === undefined) diff.push({ key, status: 'absent-from-snapshot', actual: value });
    else if (Math.abs(value - committed.value) / Math.max(Math.abs(committed.value), 1e-9) > committed.tolerance) {
      diff.push({ key, status: 'drift', expected: committed, actual: value });
    } else if (from !== undefined && to !== undefined && from !== to) diff.push({ key, status: 'moved', actual: value, from, to });
    else diff.push({ key, status: 'match', expected: committed, actual: value });
  }
  for (const [key, committed] of Object.entries(e)) {
    if (!(key in a)) diff.push({ key, status: 'absent-from-build', expected: committed });
  }
  return diff;
}

export function formatRateDiff(diff: readonly RateDiff[]): string {
  const drifted = diff.filter((d) => d.status !== 'match');
  if (drifted.length === 0) return `rates: all ${diff.length} rates within tolerance`;
  const width = Math.max(...drifted.map((d) => d.key.length));
  const lines = [`rates: ${drifted.length} of ${diff.length} rates drifted`];
  for (const d of drifted) {
    const label = `  ${d.key.padEnd(width)}`;
    switch (d.status) {
      case 'drift':
        lines.push(`${label} expected ${d.expected.value.toFixed(4)} ± ${Math.round(d.expected.tolerance * 100)}%, got ${d.actual.toFixed(4)}`);
        break;
      case 'moved':
        lines.push(`${label} ${d.actual.toFixed(4)} moved from stage ${d.from} to ${d.to}`);
        break;
      case 'absent-from-snapshot':
        lines.push(`${label} absent from snapshot, got ${d.actual.toFixed(4)}`);
        break;
      case 'absent-from-build':
        lines.push(`${label} expected ${d.expected.value.toFixed(4)}, absent from build`);
        break;
    }
  }
  return lines.join('\n');
}

/** The `compare` a rates snapshot passes to `snapshotCheck`. */
export function compareRateSnapshot(expected: RateSnapshot, actual: RateSnapshot): { drifted: boolean; report: string } {
  const diff = compareRates(expected, actual);
  return { drifted: diff.some((d) => d.status !== 'match'), report: formatRateDiff(diff) };
}
