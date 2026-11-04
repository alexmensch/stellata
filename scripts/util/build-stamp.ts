// Content-hash freshness stamps for build steps. See scripts/util/README.md.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { CODE_FILE, codeIdentities } from './code-identity';
import { REPO_ROOT } from './paths';
import { discardStaged, landStaged, writeStaged } from './staged-write';

/** Repo-relative path → sha1 of its content, or null when the file is absent. */
export type FileHashes = Readonly<Record<string, string | null>>;

/** What a recorded (Python) step listed and probed, beside the files it read. */
export interface RecordedReads {
  /** Repo-relative directory → `listingHash` of its names, or null when absent. */
  readonly listings: Readonly<Record<string, string | null>>;
  /** Repo-relative path → whether it existed. */
  readonly probes: Readonly<Record<string, boolean>>;
}

export interface Stamp {
  readonly inputs: FileHashes;
  readonly outputs: FileHashes;
  readonly recorded?: RecordedReads;
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

export type Hasher = (paths: readonly string[], root?: string) => FileHashes;

/** Content bytes, keyed relative to `root`: the identity of an output. */
export const fileHashes: Hasher = (paths, root = REPO_ROOT) => {
  const hashes: Record<string, string | null> = {};
  for (const p of [...new Set(paths)].sort()) {
    hashes[relative(root, p)] = existsSync(p) ? hashFile(p) : null;
  }
  return hashes;
};

/** As `fileHashes`, but a code file hashes as its `codeIdentities` entry: the identity of an input. */
export const inputHashes: Hasher = (paths, root = REPO_ROOT) => {
  const code = new Set(paths.filter((p) => CODE_FILE.test(p) && existsSync(p)));
  const identities = Object.entries(codeIdentities([...code])).map(([p, identity]) => [relative(root, p), identity]);
  const bytes = Object.entries(fileHashes(paths.filter((p) => !code.has(p)), root));
  return Object.fromEntries([...bytes, ...identities].sort(([a], [b]) => (a < b ? -1 : 1)));
};

/** A recorded run's reads, hashed as bytes at first read, as input hashes. A code file
 *  whose bytes moved since keeps its bytes hash, which no identity equals, so it reads stale. */
export function recordedInputs(reads: FileHashes, root: string): FileHashes {
  const code = Object.keys(reads).filter((k) => CODE_FILE.test(k) && reads[k] !== null).map((k) => resolve(root, k));
  const now = fileHashes(code, root);
  const unmoved = code.filter((p) => now[relative(root, p)] === reads[relative(root, p)]);
  return { ...reads, ...inputHashes(unmoved, root) };
}

/** Absent, unparseable and pre-outputs stamps all read as null: no stamp to trust. */
export function readStamp(stamp: string): Stamp | null {
  const parsed = readStampJson(stamp);
  return parsed === null ? null : asStamp(parsed);
}

/** The stamp file's JSON, or null when absent or unparseable. */
export function readStampJson(stamp: string): Readonly<Record<string, unknown>> | null {
  if (!existsSync(stamp)) return null;
  try {
    return JSON.parse(readFileSync(stamp, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function asStamp(json: Readonly<Record<string, unknown>>): Stamp | null {
  const parsed = json as Partial<Stamp>;
  if (!parsed.inputs || !parsed.outputs) return null;
  return parsed.recorded
    ? { inputs: parsed.inputs, outputs: parsed.outputs, recorded: parsed.recorded }
    : { inputs: parsed.inputs, outputs: parsed.outputs };
}

/** The subset of `paths` git ignores under `root`, each spelled as given. */
export function ignoredPaths(paths: readonly string[], root: string): Set<string> {
  if (paths.length === 0) return new Set();
  const run = spawnSync('git', ['check-ignore', '--stdin'], { cwd: root, input: paths.join('\n'), encoding: 'utf8' });
  if (run.status !== 0 && run.status !== 1) throw new Error(`git check-ignore exited ${run.status}: ${run.stderr.trim()}`);
  return new Set(run.stdout.split('\n').filter(Boolean));
}

/** A directory listing's hash over its sorted names, git-ignored names left out. */
export function listingHash(dir: string, names: readonly string[], root: string): string {
  const skip = ignoredPaths(names.map((n) => join(dir, n)), root);
  const kept = names.filter((n) => !skip.has(join(dir, n)));
  return createHash('sha1').update(kept.sort().join('\n')).digest('hex');
}

/** Absolute directory → its listed names, as `build_stamp.record_run` writes them, hashed;
 *  a git-ignored directory is no input and is dropped. */
export function listingHashes(listed: Readonly<Record<string, readonly string[]>>, root: string): Record<string, string> {
  const ignoredDirs = ignoredPaths(Object.keys(listed), root);
  return Object.fromEntries(Object.entries(listed)
    .filter(([dir]) => !ignoredDirs.has(dir))
    .map(([dir, names]) => [dir, listingHash(dir, names, root)]));
}

function currentListing(dir: string, root: string): string | null {
  return existsSync(dir) && statSync(dir).isDirectory() ? listingHash(dir, readdirSync(dir), root) : null;
}

/** Recorded listings and probes whose answer on disk has moved. */
export function recordedChanges({ listings, probes }: RecordedReads, root: string = REPO_ROOT): string[] {
  return [
    ...Object.keys(listings).filter((d) => currentListing(resolve(root, d), root) !== listings[d]).map((d) => `${d}/`),
    ...Object.keys(probes).filter((p) => existsSync(resolve(root, p)) !== probes[p]),
  ];
}

/** Recorded paths whose content on disk no longer matches the recorded hash, by the hasher that recorded it. */
export function changedSince(recorded: FileHashes, hash: Hasher, root: string = REPO_ROOT): string[] {
  const current = hash(Object.keys(recorded).map((p) => resolve(root, p)), root);
  return Object.keys(recorded).filter((p) => current[p] !== recorded[p]);
}

/** Must run before a build writes any output, so a build that dies midway
 *  leaves no stamp vouching for its partial outputs. */
export function clearStamp(stamp: string): void {
  rmSync(stamp, { force: true });
  discardStaged(stamp);
}

export function writeStamp(
  stamp: string,
  inputs: FileHashes,
  outputs: readonly string[],
  { recorded, root = REPO_ROOT }: { readonly recorded?: RecordedReads; readonly root?: string } = {},
): void {
  const outputHashes = fileHashes(outputs, root);
  const missing = Object.keys(outputHashes).filter((p) => outputHashes[p] === null);
  if (outputs.length === 0 || missing.length > 0) {
    throw new Error(`writeStamp(${stamp}): outputs missing or none given: ${missing.join(', ')}`);
  }
  const record: Stamp = recorded ? { inputs, outputs: outputHashes, recorded } : { inputs, outputs: outputHashes };
  writeStaged(stamp, `${JSON.stringify(record, null, 2)}\n`);
  landStaged(stamp);
}
