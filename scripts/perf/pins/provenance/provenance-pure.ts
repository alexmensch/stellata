// Where a pin's numbers came from: the run file a row cites, the commit pair
// behind it, and how far main moved above that base.
// README.md.

import { basename, relative, resolve } from 'node:path';
import type { GitProvenance } from '../../schema';

/** `checkoutRoot` is the checkout the run was WRITTEN in, which from a
 *  worktree is the worktree — README.md#sourcerun-is-relative-to-the-checkout-the-run-was-written-in. */
export function citeRunPath(jsonPath: string, checkoutRoot: string): string {
  const rel = relative(checkoutRoot, resolve(jsonPath));
  return rel === '' || rel.startsWith('..') ? basename(jsonPath) : rel;
}

/** How `git merge-base --is-ancestor` answered *now*, not when the pin was
 *  taken. README.md#what-the-commit-fields-hold. */
export type PinCommitState = 'landed' | 'unlanded' | 'unknown';

/** Only exit 1 is an answer — README.md#what-the-commit-fields-hold. */
export function commitStateFromExitStatus(status: number | undefined): PinCommitState {
  if (status === 0) return 'landed';
  return status === 1 ? 'unlanded' : 'unknown';
}

export interface RenderPathDrift {
  readonly files: number;
  readonly insertions: number;
  readonly deletions: number;
}

const SHORTSTAT = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;

/** Null is a line that could not be read; an empty one is a drift of zero. */
export function parseRenderPathDrift(shortstat: string): RenderPathDrift | null {
  if (shortstat.trim() === '') return { files: 0, insertions: 0, deletions: 0 };
  const m = SHORTSTAT.exec(shortstat);
  if (m === null) return null;
  return { files: Number(m[1]), insertions: Number(m[2] ?? 0), deletions: Number(m[3] ?? 0) };
}

/** README.md#what-the-commit-fields-hold. */
export function pinProvenanceLines(
  git: GitProvenance,
  state: PinCommitState,
  drift: RenderPathDrift | null,
  runMainCommit: string | null,
): readonly string[] {
  const short = git.commit.slice(0, 8);
  const lines: string[] = [];
  if (state === 'unlanded') {
    lines.push(
      `pin commit ${short} is not an ancestor of origin/main — a pre-squash branch tip, ` +
      'so no hash on main carries the tree it measured',
    );
  } else if (state === 'unknown') {
    lines.push(`pin commit ${short} could not be placed against origin/main — drift is unbounded`);
  }
  if (git.mainCommit === null) {
    lines.push('the pin records no main base, so its drift from main cannot be measured at all');
  } else if (drift === null) {
    lines.push(`pin main base ${git.mainCommit.slice(0, 8)}; render-path drift could not be read`);
  } else if (drift.files > 0) {
    const from = git.mainCommit.slice(0, 8);
    const to = runMainCommit === null ? 'unrecorded base' : runMainCommit.slice(0, 8);
    lines.push(
      `main's src/client differs from the pin's base ${from} to this run's ${to}: ` +
      `${drift.files} file${drift.files === 1 ? '' : 's'}, +${drift.insertions}/-${drift.deletions} — ` +
      'a mark below may be that difference rather than this diff',
    );
  }
  return lines;
}
