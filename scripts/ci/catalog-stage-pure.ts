// CI's cached catalogue build stage: its steps, the tracked files it can depend on, and their cache key.

import { createHash } from 'node:crypto';
import { dirname, extname } from 'node:path';

export interface StageStep {
  script: string;
  /** Committed paths the script regenerates; any diff after it runs fails the stage. */
  pinned: readonly string[];
}

export const CATALOG_STAGE: readonly StageStep[] = [
  { script: 'build:classic-ids', pinned: ['data/classic-ids/'] },
  { script: 'build:wgsn', pinned: ['data/iau-wgsn/'] },
  // label_flips.tsv sits under data/classic-ids/ but is written here, so it passes
  // the classic-ids diff only because this step runs after it.
  { script: 'build:membership', pinned: ['data/membership/', 'data/classic-ids/label_flips.tsv'] },
  // Without this pin the parked ledger's row content is unchecked: the count snapshot
  // pins only its length, so a build parking a different star for the same total lands.
  { script: 'build:catalog', pinned: ['data/membership/parked-ledger.tsv', 'data/athyg/simbad_sourced_distances.tsv'] },
];

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
