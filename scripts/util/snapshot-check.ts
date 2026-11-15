// Snapshot checks for emitArtifacts. See scripts/util/README.md (snapshot-check.ts entry).
import { resolve } from 'node:path';

import { compareCountSnapshot } from './counts/compare-counts-pure';
import type { Check } from './emit-artifacts';
import { REPO_ROOT } from './paths';
import type { Snapshot } from './sources/snapshot-pure';
import { readSnapshot } from './sources/source';
import { rerunCommand } from './step-command-pure';

/** Set to '1' to rewrite every snapshot instead of asserting against it; the
 *  runner's `--update-snapshots` sets it for each step it runs. */
export const UPDATE_SNAPSHOTS_ENV = 'UPDATE_SNAPSHOTS';

/** The runner sets it to the name of each step it runs, and drops an
 *  inherited UPDATE_SNAPSHOTS, so such a step refreshes through the flag. */
export const PIPELINE_STEP_ENV = 'PIPELINE_STEP';

const refreshCommand = (script: string): string => (process.env[PIPELINE_STEP_ENV] === undefined
  ? `${UPDATE_SNAPSHOTS_ENV}=1 ${rerunCommand(script)}`
  : `${rerunCommand(script)} --update-snapshots`);

export interface SnapshotCheckSpec<T> {
  actual: T;
  compare: (expected: T, actual: T) => { drifted: boolean; report: string };
  /** Merges hand-authored fields of the old snapshot into the new one on
   *  refresh (curated `reason` strings survive a regenerate). */
  refreshTransform?: (expected: T, actual: T) => T;
  failureLabel: string;
}

/** A count snapshot's check: snapshotCheck with compareCountSnapshot as its compare. */
export function countSnapshotCheck<T extends object>(
  snapshot: Snapshot<T>, opts: Omit<SnapshotCheckSpec<T>, 'compare' | 'refreshTransform'>,
): Check {
  return snapshotCheck<T>(snapshot, { ...opts, compare: compareCountSnapshot });
}

/** A missing snapshot fails: only the env var writes one. */
export function snapshotCheck<T>(snapshot: Snapshot<T>, opts: SnapshotCheckSpec<T>): Check {
  const path = resolve(REPO_ROOT, snapshot.file);
  const expected = readSnapshot(snapshot);

  if (process.env[UPDATE_SNAPSHOTS_ENV] === '1') {
    const toWrite = expected !== null && opts.refreshTransform
      ? opts.refreshTransform(expected, opts.actual)
      : opts.actual;
    return { kind: 'refresh', path, text: JSON.stringify(toWrite, null, 2) + '\n' };
  }

  if (expected === null) {
    return {
      kind: 'fail',
      message: `\n${opts.failureLabel} snapshot ${snapshot.file} is missing. To write it:\n`
        + `  ${refreshCommand(snapshot.script)}`,
    };
  }

  const { drifted, report } = opts.compare(expected, opts.actual);
  return drifted
    ? {
        kind: 'fail',
        report,
        message: `\n${opts.failureLabel} assertion failed. If the change is intentional,\n`
          + `refresh the snapshot with: ${refreshCommand(snapshot.script)}`,
      }
    : { kind: 'pass', report };
}
