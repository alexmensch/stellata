// Assert a build script's computed snapshot against its committed JSON,
// or rewrite the snapshot when its env var is set. See scripts/util/README.md.
import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

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

/** Exits the process non-zero on drift or on a missing snapshot. */
export async function assertOrUpdateSnapshot<T>(
  opts: SnapshotAssertion<T>,
): Promise<void> {
  const shouldUpdate = process.env[opts.envVar] === '1';
  const expected = existsSync(opts.snapshotPath)
    ? (JSON.parse(readFileSync(opts.snapshotPath, 'utf8')) as T)
    : null;

  if (shouldUpdate) {
    const toWrite = expected !== null && opts.refreshTransform
      ? opts.refreshTransform(expected, opts.actual)
      : opts.actual;
    await writeFile(opts.snapshotPath, JSON.stringify(toWrite, null, 2) + '\n');
    console.log(`Updated ${opts.snapshotPath}`);
    return;
  }

  if (expected === null) {
    console.error(
      `\n${opts.failureLabel} snapshot ${opts.snapshotPath} is missing. To write it:\n` +
        `  ${opts.refreshCommand}`,
    );
    process.exit(1);
  }

  const { drifted, report } = opts.compare(expected, opts.actual);
  console.log(report);
  if (drifted) {
    console.error(
      `\n${opts.failureLabel} assertion failed. If the change is intentional,\n` +
        `refresh the snapshot with: ${opts.refreshCommand}`,
    );
    process.exit(1);
  }
}
