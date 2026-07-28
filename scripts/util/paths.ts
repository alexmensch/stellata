// Repo-root path + mtime helper shared by TypeScript build scripts.
// See scripts/util/README.md.

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isLfsPointer } from '../sid/sid-pure';

const __dirname = dirname(fileURLToPath(import.meta.url));

// scripts/util/paths.ts sits two levels below the repo root
// (repo/scripts/util), matching every scripts/<folder>/*.ts consumer.
export const REPO_ROOT = resolve(__dirname, '..', '..');

export function mtimeIfExists(path: string): number {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

const LFS_PROBE_BYTES = 128;

/** Whether an LFS-tracked input is still an unsmudged pointer stub — the state
 *  a checkout without `git lfs pull` (the bare CI test job) leaves it in.
 *  Probes the head rather than reading the file, which for these inputs runs
 *  to tens of megabytes. */
export function isLfsPointerFile(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(LFS_PROBE_BYTES);
    return isLfsPointer(buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf-8'));
  } finally {
    closeSync(fd);
  }
}

export function maxMtimeOfSources(paths: string[]): number {
  let newest = 0;
  for (const p of paths) {
    const m = mtimeIfExists(p);
    if (m > newest) newest = m;
  }
  return newest;
}
