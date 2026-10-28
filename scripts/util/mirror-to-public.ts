// Shared data/<folder>/ → public/<folder>/ mirror for the sync scripts.
// See scripts/util/README.md.

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { REPO_ROOT } from './paths';
import { defineSource, type Declared, type Source } from './sources/source';

export interface MirroredFolder {
  readonly files: readonly Declared[];
  readonly isPublicAsset: (name: string) => boolean;
}

export interface MirrorSourceSpec {
  /** Repo-relative folder; its README.md is the declared file, every
   *  allowlisted file in it (and in `flattenSubDirs`) a member. */
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
  const files = (): Declared[] => [spec.dir, ...(spec.flattenSubDirs ?? []).map((d) => `${spec.dir}/${d}`)]
    .flatMap((dir) => readdirSync(resolve(REPO_ROOT, dir))
      .filter((name) => spec.isPublicAsset(name) && statSync(resolve(REPO_ROOT, dir, name)).isFile())
      .map((name) => ({ file: `${dir}/${name}`, hint: spec.hint })));
  return defineSource({
    file: `${spec.dir}/README.md`,
    hint: spec.hint,
    members: files,
    parse: () => ({ files: files(), isPublicAsset: spec.isPublicAsset }),
  });
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
    const srcPath = resolve(REPO_ROOT, file);
    const dstPath = resolve(dst, basename(file));
    const srcStat = statSync(srcPath);
    if (existsSync(dstPath)) {
      const dstStat = statSync(dstPath);
      if (dstStat.size === srcStat.size && dstStat.mtimeMs >= srcStat.mtimeMs) {
        skipped++;
        continue;
      }
    }
    copyFileSync(srcPath, dstPath);
    copied++;
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
