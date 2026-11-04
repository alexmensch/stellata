// A step's input hashes as a given commit holds its input files. See README.md.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { hashBytes, ignoredPaths, type FileHashes } from './build-stamp';
import { codeIdentities } from './code-identity';
import { gitIn } from './git-provenance';
import { CODE_FILE } from './import-closure-pure';
import { REPO_ROOT } from './paths';

export type HashesAt =
  | { readonly kind: 'hashed'; readonly hashes: FileHashes }
  | { readonly kind: 'unknown'; readonly reason: string };

const LFS_ATTR = ': filter: lfs';

function gitBytes(root: string, argv: readonly string[], input?: Buffer): Buffer | null {
  const run = spawnSync('git', argv, { cwd: root, input, maxBuffer: Number.MAX_SAFE_INTEGER });
  return run.status === 0 ? run.stdout : null;
}

function codeIdentityOf(path: string, bytes: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'identity-at-'));
  try {
    const file = join(dir, basename(path));
    writeFileSync(file, bytes);
    return codeIdentities([file])[file];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function inputHashesAt(commit: string, inputs: FileHashes, root: string = REPO_ROOT): HashesAt {
  const paths = Object.keys(inputs);
  const ignored = [...ignoredPaths(paths, root)];
  if (ignored.length > 0) return { kind: 'unknown', reason: `${ignored.join(', ')} not in git` };
  const listed = (...argv: string[]) => gitIn(root, '--literal-pathspecs', ...argv).split('\n').filter(Boolean);
  const changed = paths.length === 0 ? [] : [
    ...listed('diff', '--name-only', '--no-renames', commit, '--', ...paths),
    ...listed('ls-files', '--others', '--exclude-standard', '--', ...paths),
  ];
  if (changed.length === 0) return { kind: 'hashed', hashes: inputs };
  const stored = new Set(listed('ls-tree', '-r', '--name-only', commit, '--', ...changed));
  const lfs = new Set(listed('check-attr', 'filter', '--', ...changed)
    .filter((line) => line.endsWith(LFS_ATTR)).map((line) => line.slice(0, -LFS_ATTR.length)));
  const hashes: Record<string, string | null> = { ...inputs };
  for (const path of changed) {
    if (!stored.has(path)) {
      hashes[path] = null;
      continue;
    }
    const blob = gitBytes(root, ['show', `${commit}:${path}`]);
    if (blob === null) throw new Error(`git show ${commit}:${path} failed`);
    const bytes = lfs.has(path) ? gitBytes(root, ['lfs', 'smudge', '--', path], blob) : blob;
    if (bytes === null) return { kind: 'unknown', reason: `${path}: its LFS content at ${commit} is not available` };
    hashes[path] = CODE_FILE.test(path) ? codeIdentityOf(path, bytes) : hashBytes(bytes);
  }
  return { kind: 'hashed', hashes };
}
