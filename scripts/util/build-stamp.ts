// Content-hash freshness stamps for build steps. See scripts/util/README.md.

import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

import { REPO_ROOT } from './paths';
import { discardStaged, landStaged, writeStaged } from './staged-write';

const STAMP_FOLDER = 'build/stamps';
export const STAMP_DIR = resolve(REPO_ROOT, STAMP_FOLDER);

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

/** A step's name as a file name, for its stamp and its lock. */
export const stepFileName = (name: string): string => name.replaceAll(':', '-');

export function stampPath(name: string, root: string = REPO_ROOT): string {
  return resolve(root, STAMP_FOLDER, `${stepFileName(name)}.json`);
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

/** A directory listing's hash over its sorted names. Same formula as build_stamp.py. */
export function listingHash(names: readonly string[]): string {
  return createHash('sha1').update([...names].sort().join('\n')).digest('hex');
}

function currentListing(dir: string): string | null {
  return existsSync(dir) && statSync(dir).isDirectory() ? listingHash(readdirSync(dir)) : null;
}

/** Recorded listings and probes whose answer on disk has moved. */
export function recordedChanges({ listings, probes }: RecordedReads): string[] {
  return [
    ...Object.keys(listings).filter((d) => currentListing(resolve(REPO_ROOT, d)) !== listings[d]).map((d) => `${d}/`),
    ...Object.keys(probes).filter((p) => existsSync(resolve(REPO_ROOT, p)) !== probes[p]),
  ];
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
  discardStaged(stamp);
}

export function writeStamp(
  stamp: string,
  inputs: FileHashes,
  outputs: readonly string[],
  recorded?: RecordedReads,
): void {
  const outputHashes = fileHashes(outputs);
  const missing = Object.keys(outputHashes).filter((p) => outputHashes[p] === null);
  if (outputs.length === 0 || missing.length > 0) {
    throw new Error(`writeStamp(${stamp}): outputs missing or none given: ${missing.join(', ')}`);
  }
  const record: Stamp = recorded ? { inputs, outputs: outputHashes, recorded } : { inputs, outputs: outputHashes };
  writeStaged(stamp, `${JSON.stringify(record, null, 2)}\n`);
  landStaged(stamp);
}
