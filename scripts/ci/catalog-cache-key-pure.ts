// Which tracked files CI's cached catalogue build can depend on, and the cache key they digest to.

import { createHash } from 'node:crypto';
import { dirname, extname } from 'node:path';

export const CATALOG_CACHE_KEY_PREFIX = 'catalog-build';

const ALWAYS_KEYED_FILES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  '.github/workflows/test.yml',
]);
const ALWAYS_KEYED_DIRS = ['data/', 'scripts/ci/'];
const UNREAD_SIBLING_EXTENSIONS = new Set(['.ts', '.md']);

export type BlobIndex = ReadonlyMap<string, string>;

export function tsxEntry(scripts: Readonly<Record<string, string>>, name: string): string {
  const match = scripts[name]?.match(/^tsx (\S+\.ts)$/);
  if (!match) {
    throw new Error(`package.json script ${name} must be exactly "tsx <file>.ts", got ${JSON.stringify(scripts[name])}`);
  }
  return match[1];
}

/** `git ls-files -s -z` output → path → blob id. */
export function parseLsFilesStage(out: string): BlobIndex {
  const blobs = new Map<string, string>();
  for (const entry of out.split('\0')) {
    if (entry === '') continue;
    const tab = entry.indexOf('\t');
    const [, blob] = entry.slice(0, tab).split(' ');
    blobs.set(entry.slice(tab + 1), blob);
  }
  return blobs;
}

// see README.md § The catalogue build cache
export function keyedPaths(closure: ReadonlySet<string>, index: BlobIndex): string[] {
  const untracked = [...closure].filter((path) => !index.has(path));
  if (untracked.length > 0) {
    throw new Error(`catalogue build imports untracked files: ${untracked.join(', ')}`);
  }
  const closureDirs = new Set([...closure].map(dirname));
  return [...index.keys()]
    .filter((path) =>
      closure.has(path)
      || ALWAYS_KEYED_FILES.has(path)
      || ALWAYS_KEYED_DIRS.some((dir) => path.startsWith(dir))
      || (closureDirs.has(dirname(path)) && !UNREAD_SIBLING_EXTENSIONS.has(extname(path))))
    .sort();
}

export function catalogCacheKey(index: BlobIndex, paths: readonly string[], nodeVersion: string): string {
  const hash = createHash('sha256').update(`${nodeVersion}\n`);
  for (const path of paths) hash.update(`${index.get(path)} ${path}\n`);
  return `${CATALOG_CACHE_KEY_PREFIX}-${hash.digest('hex')}`;
}
