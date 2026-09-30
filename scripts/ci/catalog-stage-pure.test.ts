import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { tsxEntry } from '../util/import-closure-pure';
import { REPO_ROOT } from '../util/paths';
import {
  CATALOG_CACHE_KEY_PREFIX,
  CATALOG_STAGE,
  catalogCacheKey,
  keyedPaths,
  PACKAGE_JSON,
  parseLsFilesStage,
  withVersionlessPackageJson,
} from './catalog-stage-pure';

const index = (paths: string[], blob = 'b0'): Map<string, string> =>
  new Map(paths.map((p) => [p, blob]));

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

describe('withVersionlessPackageJson', () => {
  const paths = [PACKAGE_JSON];
  const keyOf = (pkg: object): string =>
    catalogCacheKey(withVersionlessPackageJson(index(paths), JSON.stringify(pkg)), paths, 'node-a');
  const base = { name: 'stellata', version: '6.0.6', scripts: { 'build:catalog': 'tsx a.ts' } };

  it('ignores a version bump, which no stage step reads', () => {
    expect(keyOf({ ...base, version: '6.1.0' })).toBe(keyOf(base));
  });

  it('moves with any other field', () => {
    expect(keyOf({ ...base, scripts: { 'build:catalog': 'tsx b.ts' } })).not.toBe(keyOf(base));
  });

  it('replaces only the package.json entry', () => {
    const tracked = index(['data/a.tsv', PACKAGE_JSON]);
    expect(withVersionlessPackageJson(tracked, JSON.stringify(base)).get('data/a.tsv')).toBe('b0');
  });
});

describe('CATALOG_STAGE', () => {
  const { scripts } = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf-8'));

  it('names only single-entry tsx scripts, so every step is keyed', () => {
    for (const { script } of CATALOG_STAGE) expect(() => tsxEntry(scripts, script)).not.toThrow();
  });

  it('pins only paths that exist', () => {
    for (const { pinned } of CATALOG_STAGE) {
      for (const path of pinned) expect(existsSync(resolve(REPO_ROOT, path)), path).toBe(true);
    }
  });
});
