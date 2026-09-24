// Content-hash freshness stamps for build steps. See scripts/util/README.md.

import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { REPO_ROOT } from './paths';

export const STAMP_DIR = resolve(REPO_ROOT, 'build/stamps');

/** Repo-relative path → sha1 of its content, or null when the file is absent. */
export type InputHashes = Readonly<Record<string, string | null>>;

export function stampPath(name: string): string {
  return resolve(STAMP_DIR, `${name}.json`);
}

const HASH_CHUNK_BYTES = 1 << 22;

export function hashFile(path: string): string {
  const hash = createHash('sha1');
  const buf = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  const fd = openSync(path, 'r');
  try {
    for (let n; (n = readSync(fd, buf)) > 0;) hash.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

export function inputHashes(paths: readonly string[]): InputHashes {
  const hashes: Record<string, string | null> = {};
  for (const p of [...new Set(paths)].sort()) {
    hashes[relative(REPO_ROOT, p)] = existsSync(p) ? hashFile(p) : null;
  }
  return hashes;
}

export function readStamp(stamp: string): InputHashes | null {
  if (!existsSync(stamp)) return null;
  return (JSON.parse(readFileSync(stamp, 'utf8')) as { inputs: InputHashes }).inputs;
}

function sameHashes(a: InputHashes, b: InputHashes): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

export function stampIsCurrent(
  stamp: string, hashes: InputHashes, outputs: readonly string[],
): boolean {
  const recorded = readStamp(stamp);
  return recorded !== null && outputs.every(existsSync) && sameHashes(recorded, hashes);
}

/** Must run before a build writes any output, so a build that dies midway
 *  leaves no stamp vouching for its partial outputs. */
export function clearStamp(stamp: string): void {
  rmSync(stamp, { force: true });
}

export function writeStamp(stamp: string, hashes: InputHashes): void {
  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(stamp, `${JSON.stringify({ inputs: hashes }, null, 2)}\n`);
}
