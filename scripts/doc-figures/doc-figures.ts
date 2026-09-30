// The tree's side of doc figures: the committed count snapshots, and every doc that can carry a marker.
import { lstatSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gitFiles } from '../util/git-files';
import { SNAPSHOT_SUFFIX, type Snapshots } from './doc-figures-pure';

export function loadSnapshots(root: string): Snapshots {
  const snapshots = new Map<string, unknown>();
  for (const path of gitFiles(root, [`*${SNAPSHOT_SUFFIX}`])) {
    const stem = basename(path, SNAPSHOT_SUFFIX);
    if (snapshots.has(stem)) throw new Error(`two snapshots share the stem ${stem}; doc-figure keys would be ambiguous`);
    snapshots.set(stem, JSON.parse(readFileSync(join(root, path), 'utf8')));
  }
  return snapshots;
}

/** Tracked and untracked-but-not-ignored markdown, symlinks excluded (`CLAUDE.md` would double `AGENTS.md`). */
export function docFiles(root: string): string[] {
  return gitFiles(root, ['*.md'], { untracked: true }).filter((f) => !lstatSync(join(root, f)).isSymbolicLink());
}
