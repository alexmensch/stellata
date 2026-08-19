// Shared data/<folder>/ → public/<folder>/ mirror for the sync scripts.
// See scripts/util/README.md.

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from './paths';

export type MirrorSpec = {
  /** Repo-relative source folder, e.g. `data/dust`. */
  srcDir: string;
  /** Repo-relative destination folder, e.g. `public/dust`. */
  dstDir: string;
  isPublicAsset: (name: string) => boolean;
  /** Prefix for the one-line console summary. */
  label: string;
  /**
   * Subfolders of `srcDir` whose files are **flattened** into the same
   * destination. Lets a data folder group large artifacts at rest without
   * moving them in `public/` — so no consumer URL changes when it does.
   * Names must stay unique across all of them; the allowlist is by name
   * and the purge pass cannot tell two same-named files apart.
   */
  flattenSubDirs?: readonly string[];
};

export function mirrorDataFolder(spec: MirrorSpec): void {
  const src = resolve(REPO_ROOT, spec.srcDir);
  const dst = resolve(REPO_ROOT, spec.dstDir);

  if (!existsSync(src)) {
    console.log(`${spec.srcDir}/ not found; skipping ${spec.label} sync.`);
    return;
  }
  mkdirSync(dst, { recursive: true });

  let copied = 0;
  let skipped = 0;
  for (const from of [src, ...(spec.flattenSubDirs ?? []).map((d) => resolve(src, d))]) {
    if (!existsSync(from)) continue;
    for (const name of readdirSync(from)) {
      if (!spec.isPublicAsset(name)) continue;
      const srcPath = resolve(from, name);
      const dstPath = resolve(dst, name);
      const srcStat = statSync(srcPath);
      if (!srcStat.isFile()) continue;
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
  }

  let purged = 0;
  for (const name of readdirSync(dst)) {
    if (spec.isPublicAsset(name)) continue;
    rmSync(resolve(dst, name), { recursive: true });
    purged++;
  }

  const purgedNote = purged > 0 ? `, ${purged} stray file(s) purged` : '';
  console.log(`${spec.label} sync: ${copied} copied, ${skipped} up-to-date${purgedNote}`);
}
