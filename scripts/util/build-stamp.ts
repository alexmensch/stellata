// Content-hash freshness stamps for build steps. See scripts/util/README.md.

import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import { REPO_ROOT } from './paths';

export const STAMP_DIR = resolve(REPO_ROOT, 'build/stamps');

/** Repo-relative path → sha1 of its content, or null when the file is absent. */
export type FileHashes = Readonly<Record<string, string | null>>;

export interface Stamp {
  readonly inputs: FileHashes;
  readonly outputs: FileHashes;
}

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

export function fileHashes(paths: readonly string[]): FileHashes {
  const hashes: Record<string, string | null> = {};
  for (const p of [...new Set(paths)].sort()) {
    hashes[relative(REPO_ROOT, p)] = existsSync(p) ? hashFile(p) : null;
  }
  return hashes;
}

/** Absent, unparseable and pre-outputs stamps all read as null: no stamp to trust. */
export function readStamp(stamp: string): Stamp | null {
  if (!existsSync(stamp)) return null;
  let parsed: Partial<Stamp>;
  try {
    parsed = JSON.parse(readFileSync(stamp, 'utf8')) as Partial<Stamp>;
  } catch {
    return null;
  }
  return parsed.inputs && parsed.outputs ? { inputs: parsed.inputs, outputs: parsed.outputs } : null;
}

function sameHashes(a: FileHashes, b: FileHashes): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/** Recorded paths whose content on disk no longer matches the recorded hash. */
export function changedSince(recorded: FileHashes): string[] {
  const current = fileHashes(Object.keys(recorded).map((p) => resolve(REPO_ROOT, p)));
  return Object.keys(recorded).filter((p) => current[p] !== recorded[p]);
}

export function stampIsCurrent(stamp: string, inputs: FileHashes): boolean {
  const recorded = readStamp(stamp);
  return recorded !== null
    && sameHashes(recorded.inputs, inputs)
    && changedSince(recorded.outputs).length === 0;
}

/** Must run before a build writes any output, so a build that dies midway
 *  leaves no stamp vouching for its partial outputs. */
export function clearStamp(stamp: string): void {
  rmSync(stamp, { force: true });
}

export function writeStamp(stamp: string, inputs: FileHashes, outputs: readonly string[]): void {
  const outputHashes = fileHashes(outputs);
  const missing = Object.keys(outputHashes).filter((p) => outputHashes[p] === null);
  if (outputs.length === 0 || missing.length > 0) {
    throw new Error(`writeStamp(${stamp}): outputs missing or none given: ${missing.join(', ')}`);
  }
  mkdirSync(dirname(stamp), { recursive: true });
  const tmp = `${stamp}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ inputs, outputs: outputHashes }, null, 2)}\n`);
  renameSync(tmp, stamp);
}
