// Snapshot checks for emitArtifacts. See scripts/util/README.md (snapshot-check.ts entry).
import { existsSync, readFileSync } from 'node:fs';

import type { Check } from './emit-artifacts';

export interface SnapshotCheckSpec<T> {
  /** Set to '1' to rewrite the snapshot instead of asserting against it. */
  envVar: string;
  snapshotPath: string;
  actual: T;
  compare: (expected: T, actual: T) => { drifted: boolean; report: string };
  /** Merges hand-authored fields of the old snapshot into the new one on
   *  refresh (curated `reason` strings survive a regenerate). */
  refreshTransform?: (expected: T, actual: T) => T;
  failureLabel: string;
  refreshCommand: string;
}

/** A missing snapshot fails: only the env var writes one. */
export function snapshotCheck<T>(opts: SnapshotCheckSpec<T>): Check {
  const expected = existsSync(opts.snapshotPath)
    ? (JSON.parse(readFileSync(opts.snapshotPath, 'utf8')) as T)
    : null;

  if (process.env[opts.envVar] === '1') {
    const toWrite = expected !== null && opts.refreshTransform
      ? opts.refreshTransform(expected, opts.actual)
      : opts.actual;
    return { kind: 'refresh', path: opts.snapshotPath, text: JSON.stringify(toWrite, null, 2) + '\n' };
  }

  if (expected === null) {
    return {
      kind: 'fail',
      message: `\n${opts.failureLabel} snapshot ${opts.snapshotPath} is missing. To write it:\n`
        + `  ${opts.refreshCommand}`,
    };
  }

  const { drifted, report } = opts.compare(expected, opts.actual);
  return drifted
    ? {
        kind: 'fail',
        report,
        message: `\n${opts.failureLabel} assertion failed. If the change is intentional,\n`
          + `refresh the snapshot with: ${opts.refreshCommand}`,
      }
    : { kind: 'pass', report };
}
