// A step's input hashes as a given commit holds its input files. See README.md.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { hashBytes, hashFile, ignoredPaths, type FileHashes } from './build-stamp';
import { codeIdentities } from './code-identity';
import { fileAt, gitIn } from './git-provenance';
import { CODE_FILE } from './import-closure-pure';
import { isLfsPointer, REPO_ROOT } from './paths';

export type HashesAt =
  | { readonly kind: 'hashed'; readonly hashes: FileHashes }
  | { readonly kind: 'unknown'; readonly reason: string };

const LFS_ATTR = ': filter: lfs';
const LFS_OID = /^oid sha256:([0-9a-f]{64})$/m;
const LFS_POINTER_MAX_BYTES = 1024;

function lfsStorage(root: string): string {
  const common = resolve(root, gitIn(root, 'rev-parse', '--git-common-dir'));
  try {
    return resolve(common, gitIn(root, 'config', 'lfs.storage'));
  } catch {
    return join(common, 'lfs');
  }
}

type Held =
  | { readonly kind: 'blob' }
  | { readonly kind: 'lfs-object'; readonly path: string }
  | { readonly kind: 'lfs-not-stored' };

/** Not `git lfs smudge`: it fetches over the network, and under GIT_LFS_SKIP_SMUDGE hands back the pointer. */
function lfsHeld(blob: Buffer, root: string): Held {
  const text = blob.length < LFS_POINTER_MAX_BYTES ? blob.toString('utf8') : '';
  const oid = isLfsPointer(text) ? LFS_OID.exec(text)?.[1] : undefined;
  if (oid === undefined) return { kind: 'blob' };
  const path = join(lfsStorage(root), 'objects', oid.slice(0, 2), oid.slice(2, 4), oid);
  return existsSync(path) ? { kind: 'lfs-object', path } : { kind: 'lfs-not-stored' };
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
  const lfs = new Set(listed('check-attr', 'filter', '--', ...changed)
    .filter((line) => line.endsWith(LFS_ATTR)).map((line) => line.slice(0, -LFS_ATTR.length)));
  const hashes: Record<string, string | null> = { ...inputs };
  for (const path of changed) {
    const stored = fileAt(commit, path, root);
    if (stored.kind === 'absent') {
      hashes[path] = null;
      continue;
    }
    const held: Held = lfs.has(path) ? lfsHeld(stored.bytes, root) : { kind: 'blob' };
    if (held.kind === 'lfs-not-stored') {
      return { kind: 'unknown', reason: `${path}: its LFS content at ${commit} is not stored locally` };
    }
    const code = CODE_FILE.test(path);
    if (held.kind === 'blob') hashes[path] = code ? codeIdentityOf(path, stored.bytes) : hashBytes(stored.bytes);
    else hashes[path] = code ? codeIdentityOf(path, readFileSync(held.path)) : hashFile(held.path);
  }
  return { kind: 'hashed', hashes };
}
