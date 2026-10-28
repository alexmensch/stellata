// Shared data/<folder>/ → public/<folder>/ mirror for the sync scripts.
// See scripts/util/README.md.

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { REPO_ROOT } from './paths';
import { defineFolder, type Declared, type Source } from './sources/source';

export interface MirroredFolder {
  readonly files: readonly Declared[];
  readonly isPublicAsset: (name: string) => boolean;
}

export interface MirrorSourceSpec {
  /** Repo-relative folder; every allowlisted file in it (and in
   *  `flattenSubDirs`) is a member. */
  readonly dir: string;
  readonly hint: string;
  readonly isPublicAsset: (name: string) => boolean;
  /**
   * Subfolders of `dir` whose files are **flattened** into the same
   * destination.
   * Names must stay unique across all of them; the allowlist is by name
   * and the purge pass cannot tell two same-named files apart.
   */
  readonly flattenSubDirs?: readonly string[];
}

export function mirrorSource(spec: MirrorSourceSpec): Source<MirroredFolder> {
  return defineFolder({
    dir: spec.dir,
    hint: spec.hint,
    include: spec.isPublicAsset,
    subDirs: spec.flattenSubDirs,
    parse: (folder) => ({ files: folder.members, isPublicAsset: spec.isPublicAsset }),
  });
}

/** Copies `src` over `dst` unless `dst` already holds its size and is no older. */
export function syncFile(src: string, dst: string): 'copied' | 'up-to-date' {
  if (existsSync(dst)) {
    const srcStat = statSync(src);
    const dstStat = statSync(dst);
    if (dstStat.size === srcStat.size && dstStat.mtimeMs >= srcStat.mtimeMs) return 'up-to-date';
  }
  copyFileSync(src, dst);
  return 'copied';
}

export interface MirrorSpec {
  /** Repo-relative destination folder, e.g. `public/dust`. */
  readonly dstDir: string;
  /** Prefix for the one-line console summary. */
  readonly label: string;
}

export function mirrorDataFolder({ files, isPublicAsset }: MirroredFolder, spec: MirrorSpec): void {
  const dst = resolve(REPO_ROOT, spec.dstDir);
  mkdirSync(dst, { recursive: true });

  let copied = 0;
  let skipped = 0;
  for (const { file } of files) {
    if (syncFile(resolve(REPO_ROOT, file), resolve(dst, basename(file))) === 'copied') copied++;
    else skipped++;
  }

  let purged = 0;
  for (const name of readdirSync(dst)) {
    if (isPublicAsset(name)) continue;
    rmSync(resolve(dst, name), { recursive: true });
    purged++;
  }

  const purgedNote = purged > 0 ? `, ${purged} stray file(s) purged` : '';
  console.log(`${spec.label} sync: ${copied} copied, ${skipped} up-to-date${purgedNote}`);
}
