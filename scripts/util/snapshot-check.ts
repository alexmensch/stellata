// Snapshot checks for emitArtifacts. See scripts/util/README.md (snapshot-check.ts entry).
import { existsSync, readFileSync } from 'node:fs';

import { compareCountSnapshot } from './counts/compare-counts-pure';
import type { Check } from './emit-artifacts';
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
  snapshotPath: string;
  actual: T;
  compare: (expected: T, actual: T) => { drifted: boolean; report: string };
  /** Merges hand-authored fields of the old snapshot into the new one on
   *  refresh (curated `reason` strings survive a regenerate). */
  refreshTransform?: (expected: T, actual: T) => T;
  failureLabel: string;
  /** The `package.json` script the refresh message names. */
  script: string;
}

/** A count snapshot's check: snapshotCheck with compareCountSnapshot as its compare. */
export function countSnapshotCheck<T extends object>(
  opts: Omit<SnapshotCheckSpec<T>, 'compare' | 'refreshTransform'>,
): Check {
  return snapshotCheck<T>({ ...opts, compare: compareCountSnapshot });
}

/** A missing snapshot fails: only the env var writes one. */
export function snapshotCheck<T>(opts: SnapshotCheckSpec<T>): Check {
  const expected = existsSync(opts.snapshotPath)
    ? (JSON.parse(readFileSync(opts.snapshotPath, 'utf8')) as T)
    : null;

  if (process.env[UPDATE_SNAPSHOTS_ENV] === '1') {
    const toWrite = expected !== null && opts.refreshTransform
      ? opts.refreshTransform(expected, opts.actual)
      : opts.actual;
    return { kind: 'refresh', path: opts.snapshotPath, text: JSON.stringify(toWrite, null, 2) + '\n' };
  }

  if (expected === null) {
    return {
      kind: 'fail',
      message: `\n${opts.failureLabel} snapshot ${opts.snapshotPath} is missing. To write it:\n`
        + `  ${refreshCommand(opts.script)}`,
    };
  }

  const { drifted, report } = opts.compare(expected, opts.actual);
  return drifted
    ? {
        kind: 'fail',
        report,
        message: `\n${opts.failureLabel} assertion failed. If the change is intentional,\n`
          + `refresh the snapshot with: ${refreshCommand(opts.script)}`,
      }
    : { kind: 'pass', report };
}
