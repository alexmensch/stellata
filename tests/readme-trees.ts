// Folder walk shared by the folder-README suites; see tests/README.md.
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// A README outside these costs nothing until a session deliberately opens it
// (research/ holds frozen reports that are allowed to run long).
export const README_TREES = ['src', 'scripts', 'data', 'docs'];

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.vite', '.wrangler', 'public',
  '__pycache__', '.beads', '.claude', '.venv', 'coverage',
  'screenshots',
]);

/** A batched refresh's resume cache (`<output>.tsv.ckpt/`, gitignored, removed
 *  once every batch lands — /scripts/refresh/README.md#resuming-a-long-pull).
 *  It exists for hours during a normal pull, so matching it by name would mean
 *  these suites fail for anyone who runs the tests meanwhile. */
const EXCLUDED_SUFFIXES = ['.ckpt'];

// see /data/papers/README.md#the-pdfs-are-private
const EXCLUDED_PATHS = new Set(['data/papers/pdf']);

export function readmeTreeFolders(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    out.push(dir);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (EXCLUDED_SUFFIXES.some((s) => entry.name.endsWith(s))) continue;
      const full = join(dir, entry.name);
      if (EXCLUDED_PATHS.has(relative(root, full))) continue;
      walk(full);
    }
  };
  for (const tree of README_TREES) {
    const full = resolve(root, tree);
    if (existsSync(full)) walk(full);
  }
  return out;
}
