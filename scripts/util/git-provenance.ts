// What a build or instrument records about the checkout it ran in: the package version, HEAD, a dirty tree, the merge-base with main. See README.md.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PACKAGE_JSON, REPO_ROOT } from './paths';

export const MAIN_REF = 'origin/main';

function git(...argv: string[]): string {
  return execFileSync('git', argv, {
    cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function packageVersion(): string {
  return (JSON.parse(readFileSync(resolve(REPO_ROOT, PACKAGE_JSON), 'utf-8')) as { version: string }).version;
}

/** Throws where git cannot answer: no repository, no HEAD. */
export function headState(): { readonly commit: string; readonly dirty: boolean } {
  return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0 };
}

/** Null where there is none to find: no `origin/main`, or a shallow clone. */
export function mergeBaseWithMain(commit = 'HEAD'): string | null {
  try {
    return git('merge-base', commit, MAIN_REF);
  } catch {
    return null;
  }
}

export type MergeBaseFile =
  | { readonly kind: 'present'; readonly text: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'no-merge-base' };

/** A repo-relative file as the merge-base with main holds it. `absent` is a
 *  real answer — the file is new on this branch — never a failed git. */
export function fileAtMergeBase(path: string): MergeBaseFile {
  const base = mergeBaseWithMain();
  if (base === null) return { kind: 'no-merge-base' };
  try {
    git('cat-file', '-e', `${base}:${path}`);
  } catch {
    return { kind: 'absent' };
  }
  return {
    kind: 'present',
    text: execFileSync('git', ['show', `${base}:${path}`], { cwd: REPO_ROOT, encoding: 'utf-8' }),
  };
}
