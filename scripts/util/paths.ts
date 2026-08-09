// Repo-root path + mtime helper shared by TypeScript build scripts.
// See scripts/util/README.md.

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// scripts/util/paths.ts sits two levels below the repo root
// (repo/scripts/util), matching every scripts/<folder>/*.ts consumer.
export const REPO_ROOT = resolve(__dirname, '..', '..');

/** The upstream AT-HYG catalogue. **Not a build input** — the record build
 *  walks `data/athyg/inherited-spine.tsv` instead, and re-enrolling this path
 *  in a build's mtime set would make a catalogue nothing reads invalidate the
 *  artifact. Its remaining readers each sit in a different folder, which is
 *  why the path resolves here (`data/athyg/README.md` § Consumed by). */
export const ATHYG_CSV = resolve(REPO_ROOT, 'data/athyg/athyg_33_classic_ids.csv');

export function mtimeIfExists(path: string): number {
  return existsSync(path) ? statSync(path).mtimeMs : 0;
}

const LFS_PROBE_BYTES = 128;

/** Git-LFS pointer stub — the file content is elsewhere; content checks
 *  must skip rather than "validate" the stub. */
export function isLfsPointer(text: string): boolean {
  return text.startsWith('version https://git-lfs.github.com/spec/');
}

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

/** Whether an LFS-tracked input's real content is on disk: present, and
 *  smudged rather than a pointer stub. The self-skip predicate for suites that
 *  probe an input they may not read at all — the text-taking `isLfsPointer` is
 *  for the ones that have to read it anyway. */
export function lfsContentReadable(path: string): boolean {
  return existsSync(path) && !isLfsPointerFile(path);
}

export function maxMtimeOfSources(paths: string[]): number {
  let newest = 0;
  for (const p of paths) {
    const m = mtimeIfExists(p);
    if (m > newest) newest = m;
  }
  return newest;
}
