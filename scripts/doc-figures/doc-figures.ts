// The tree's side of doc figures: the committed count snapshots, and every doc that can carry a marker.
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { gitFiles, presentFiles } from '../util/git-files';
import { SNAPSHOT_SUFFIX, type Snapshots } from './doc-figures-pure';

export function loadSnapshots(root: string): Snapshots {
  const snapshots = new Map<string, unknown>();
  for (const path of presentFiles(root, gitFiles(root, [`*${SNAPSHOT_SUFFIX}`]))) {
    const stem = basename(path, SNAPSHOT_SUFFIX);
    if (snapshots.has(stem)) throw new Error(`two snapshots share the stem ${stem}; doc-figure keys would be ambiguous`);
    snapshots.set(stem, JSON.parse(readFileSync(join(root, path), 'utf8')));
  }
  return snapshots;
}

export function docFiles(root: string): string[] {
  return presentFiles(root, gitFiles(root, ['*.md'], { untracked: true }));
}
