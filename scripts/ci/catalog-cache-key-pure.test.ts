import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import {
  CATALOG_CACHE_KEY_PREFIX,
  catalogCacheKey,
  keyedPaths,
  parseLsFilesStage,
  tsxEntry,
} from './catalog-cache-key-pure';

const index = (paths: string[], blob = 'b0'): Map<string, string> =>
  new Map(paths.map((p) => [p, blob]));

describe('tsxEntry', () => {
  it('reads the entry of a single tsx script', () => {
    expect(tsxEntry({ 'build:x': 'tsx scripts/x/build-x.ts' }, 'build:x')).toBe('scripts/x/build-x.ts');
  });

  it('refuses a chained or missing script rather than keying half of it', () => {
    expect(() => tsxEntry({ 'build:x': 'tsx a.ts && tsx b.ts' }, 'build:x')).toThrow(/build:x/);
    expect(() => tsxEntry({}, 'build:y')).toThrow(/build:y/);
  });
});

describe('parseLsFilesStage', () => {
  it('maps each path, spaces included, to its blob id', () => {
    const out = '100644 aaa 0\tdata/a.tsv\u0000100755 bbb 0\tscripts/with space.ts\u0000';
    expect([...parseLsFilesStage(out)]).toEqual([
      ['data/a.tsv', 'aaa'],
      ['scripts/with space.ts', 'bbb'],
    ]);
  });
});

describe('keyedPaths', () => {
  const tracked = index([
    'data/sub/input.tsv',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json',
    '.github/workflows/test.yml',
    'scripts/ci/README.md',
    'scripts/cat/build.ts',
    'scripts/cat/build.test.ts',
    'scripts/cat/unimported.ts',
    'scripts/cat/build-expected.json',
    'scripts/cat/README.md',
    'scripts/cat/deeper/sibling-of-nothing.json',
    'scripts/other/tool.ts',
    'src/client/util/helper.ts',
  ]);

  it('keys the closure, its non-code siblings and the always-keyed roots, and nothing else', () => {
    expect(keyedPaths(new Set(['scripts/cat/build.ts', 'src/client/util/helper.ts']), tracked)).toEqual([
      '.github/workflows/test.yml',
      'data/sub/input.tsv',
      'package.json',
      'pnpm-lock.yaml',
      'scripts/cat/build-expected.json',
      'scripts/cat/build.ts',
      'scripts/ci/README.md',
      'src/client/util/helper.ts',
      'tsconfig.json',
    ]);
  });

  it('refuses a closure module git does not track, which no key could cover', () => {
    expect(() => keyedPaths(new Set(['scripts/cat/new.ts']), tracked)).toThrow(/scripts\/cat\/new\.ts/);
  });
});

describe('catalogCacheKey', () => {
  const paths = ['a', 'b'];
  const key = catalogCacheKey(index(paths), paths, 'node-a');

  it('is prefixed and stable for the same inputs', () => {
    expect(key.startsWith(`${CATALOG_CACHE_KEY_PREFIX}-`)).toBe(true);
    expect(catalogCacheKey(index(paths), paths, 'node-a')).toBe(key);
  });

  it('moves with any blob, the path set, or the node version', () => {
    expect(catalogCacheKey(new Map([['a', 'b0'], ['b', 'b1']]), paths, 'node-a')).not.toBe(key);
    expect(catalogCacheKey(index(['a', 'b', 'c']), ['a', 'b', 'c'], 'node-a')).not.toBe(key);
    expect(catalogCacheKey(index(paths), paths, 'node-b')).not.toBe(key);
  });
});

describe('test.yml catalogue cache', () => {
  const workflow = readFileSync(resolve(REPO_ROOT, '.github/workflows/test.yml'), 'utf-8');

  it('keys exactly the package scripts its cache-miss steps run', () => {
    const keyed = workflow.match(/catalog-cache-key\.ts ([^)]+)\)/)?.[1].trim().split(/\s+/);
    const gated = [...workflow.matchAll(
      /- if: steps\.catalog-cache\.outputs\.cache-hit != 'true'\n\s+run: pnpm run (\S+)\n/g,
    )].map((m) => m[1]);
    expect(gated.length).toBeGreaterThan(0);
    expect(keyed).toEqual(gated);
  });
});
