// Which source tree a repo path belongs to. See README.md.
import { sep } from 'node:path';

export type Tree = 'astro-core' | 'catalog-format' | 'viewer' | 'pipeline' | 'tooling' | 'integration' | 'other';

// Longest prefix wins, so the tooling roots carve out of scripts/.
export const TREE_ROOTS: ReadonlyArray<readonly [string, Tree]> = [
  ['src/astro-core/', 'astro-core'],
  ['src/catalog-format/', 'catalog-format'],
  ['src/client/', 'viewer'],
  ['scripts/perf/', 'tooling'],
  ['scripts/release/', 'tooling'],
  ['scripts/', 'pipeline'],
  ['tests/integration/', 'integration'],
];

/** The trees the browser bundle is built from. */
export const BROWSER_TREES: ReadonlySet<Tree> = new Set(['viewer', 'astro-core', 'catalog-format']);

export const treeRoots = (trees: ReadonlySet<Tree>): string[] =>
  TREE_ROOTS.filter(([, t]) => trees.has(t)).map(([root]) => root);

export function treeOf(repoPath: string): Tree {
  const p = repoPath.split(sep).join('/');
  let best: readonly [string, Tree] | undefined;
  for (const entry of TREE_ROOTS) {
    if (p.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best ? best[1] : 'other';
}
