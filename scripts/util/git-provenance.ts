// What a build or instrument records about the checkout it ran in: the package version, HEAD, a dirty tree, the merge-base with main. See README.md.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PACKAGE_JSON, REPO_ROOT } from './paths';

export const MAIN_REF = 'origin/main';

/** git's trimmed stdout, run in `cwd`; throws on a non-zero exit. */
export function gitIn(cwd: string, ...argv: string[]): string {
  return execFileSync('git', argv, {
    cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28,
  }).trim();
}

const git = (...argv: string[]): string => gitIn(REPO_ROOT, ...argv);

export function packageVersion(): string {
  return (JSON.parse(readFileSync(resolve(REPO_ROOT, PACKAGE_JSON), 'utf-8')) as { version: string }).version;
}

export const headCommit = (): string => git('rev-parse', 'HEAD');

/** Throws where git cannot answer: no repository, no HEAD. */
export function headState(): { readonly commit: string; readonly dirty: boolean } {
  return { commit: headCommit(), dirty: git('status', '--porcelain').length > 0 };
}

/** False for a commit this repository does not hold. */
export function inHeadHistory(commit: string): boolean {
  try {
    git('merge-base', '--is-ancestor', commit, 'HEAD');
    return true;
  } catch {
    return false;
  }
}

/** Null where there is none to find: no `origin/main`, or a shallow clone. */
export function mergeBaseWithMain(commit = 'HEAD'): string | null {
  try {
    return git('merge-base', commit, MAIN_REF);
  } catch {
    return null;
  }
}

export type FileAt =
  | { readonly kind: 'present'; readonly bytes: Buffer }
  | { readonly kind: 'absent' };

/** A file relative to `root` as `commit` stores it. `absent` is a real answer —
 *  `commit` has no such path — never a failed git. */
export function fileAt(commit: string, path: string, root: string = REPO_ROOT): FileAt {
  try {
    gitIn(root, 'cat-file', '-e', `${commit}:${path}`);
  } catch {
    return { kind: 'absent' };
  }
  return {
    kind: 'present',
    bytes: execFileSync('git', ['show', `${commit}:${path}`], { cwd: root, maxBuffer: Number.MAX_SAFE_INTEGER }),
  };
}

export type MergeBaseFile =
  | { readonly kind: 'present'; readonly text: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'no-merge-base' };

/** A repo-relative file as the merge-base with main holds it: absent when it is new on this branch. */
export function fileAtMergeBase(path: string): MergeBaseFile {
  const base = mergeBaseWithMain();
  if (base === null) return { kind: 'no-merge-base' };
  const at = fileAt(base, path);
  return at.kind === 'absent' ? at : { kind: 'present', text: at.bytes.toString('utf8') };
}
