// Count-snapshot checks. See scripts/util/README.md (snapshot-assert.ts entry).
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import type { Check } from './emit-artifacts';

export interface SnapshotAssertion<T> {
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
export function snapshotCheck<T>(opts: SnapshotAssertion<T>): Check {
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

/** Exits the process non-zero on drift or on a missing snapshot. */
export async function assertOrUpdateSnapshot<T>(
  opts: SnapshotAssertion<T>,
): Promise<void> {
  const check = snapshotCheck(opts);
  if (check.kind === 'refresh') {
    await writeFile(check.path, check.text);
    console.log(`Updated ${check.path}`);
    return;
  }
  if (check.report !== undefined) console.log(check.report);
  if (check.kind === 'fail') {
    console.error(check.message);
    process.exit(1);
  }
}
