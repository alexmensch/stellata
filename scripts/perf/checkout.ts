// What the runner and the offline pin writer share about the checkout they
// run in: its root, the main checkout runs are filed under, git provenance,
// and the pin's on-disk read / compare / write.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  PIN_SCHEMA, PinError, commitStateFromExitStatus, compareToPin, parseRenderPathDrift, pinProvenanceLines,
  type PinCommitState, type PinDiff, type PinFile, type RenderPathDrift,
} from './pin-pure';
import { SchemaError, type GitProvenance, type PerfFile } from './schema';
import { formatPinTable } from './table-pure';

export const REPO_ROOT = resolve(import.meta.dirname, '../..');

const MAIN_REF = 'origin/main';

const git = (...argv: string[]): string =>
  execFileSync('git', argv, { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();

export function packageVersion(): string {
  return (JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8')) as { version: string }).version;
}

/** Runs are filed in the main checkout, which is not this worktree's root:
 *  `--git-common-dir` prints `<main checkout>/.git` from either. */
export function mainCheckout(): string {
  try {
    return dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir'));
  } catch {
    return REPO_ROOT;
  }
}

/** pins/README.md § What the commit fields hold. */
export function gitMeta(): GitProvenance {
  let commit = 'unavailable';
  let dirty = true;
  try {
    commit = git('rev-parse', 'HEAD');
    dirty = git('status', '--porcelain').length > 0;
  } catch (e) {
    return { commit: `unavailable (${(e as Error).message})`, dirty: true, mainCommit: null, mainReachable: false };
  }
  let mainCommit: string | null = null;
  try {
    mainCommit = git('merge-base', commit, MAIN_REF);
  } catch {
    mainCommit = null;
  }
  return { commit, dirty, mainCommit, mainReachable: commitState(commit) === 'landed' };
}

/** Asked at comparison time, never read off the pin's own `mainReachable`: a
 *  tip unlanded when the pin was taken may have landed since, and one that
 *  squash-merged never will. */
export function commitState(commit: string): PinCommitState {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, MAIN_REF], { cwd: REPO_ROOT, stdio: 'ignore' });
    return commitStateFromExitStatus(0);
  } catch (e) {
    return commitStateFromExitStatus((e as { status?: number }).status);
  }
}

/** Main's own render-path movement between the pin's base and this run's, so
 *  a reader sees what else is in the delta before reading a mark. Restricted
 *  to `src/client`: that is what a frame time is a property of. */
export function renderPathDrift(from: string | null, to: string | null): RenderPathDrift | null {
  if (from === null || to === null) return null;
  if (from === to) return { files: 0, insertions: 0, deletions: 0 };
  try {
    return parseRenderPathDrift(git('diff', '--shortstat', from, to, '--', 'src/client'));
  } catch {
    return null;
  }
}

export function readJsonFlag<T>(
  flag: string,
  path: string,
  parse: (value: unknown, source: string) => T,
): { value: T | null; error: string | null } {
  try {
    return { value: parse(JSON.parse(readFileSync(path, 'utf-8')), path), error: null };
  } catch (e) {
    const why = e instanceof SchemaError || e instanceof PinError || e instanceof SyntaxError
      ? (e as Error).message
      : `unreadable — ${(e as Error).message}`;
    return { value: null, error: `${flag} ${why}` };
  }
}

/** The verdicts against a pin, with the provenance lines a reader must weigh
 *  before any row. Returns the comparison so a write can refuse to pin over a
 *  mark nobody accepted. */
export function printAgainstPin(path: string, pin: PinFile, current: PerfFile): PinDiff {
  console.log(`\nperf: against pin ${path} (${pin.git.commit.slice(0, 8)}, v${pin.version}, ${pin.adapterSlug})`);
  for (const line of pinProvenanceLines(
    pin,
    commitState(pin.git.commit),
    renderPathDrift(pin.git.mainCommit, current.run.git.mainCommit),
    current.run.git.mainCommit,
  )) {
    console.log(`perf: ${line}`);
  }
  const diff = compareToPin(pin, current);
  console.log(formatPinTable(diff));
  return diff;
}

export function writePinFile(path: string, pin: PinFile): void {
  writeFileSync(path, `${JSON.stringify(pin, null, 2)}\n`);
  console.log(
    `perf: wrote pin ${path} (${PIN_SCHEMA}, ${pin.rows.length} rows, ${pin.adapterSlug}, v${pin.version}, ` +
    `from ${pin.sourceRuns.length} run file${pin.sourceRuns.length === 1 ? '' : 's'})`,
  );
}
