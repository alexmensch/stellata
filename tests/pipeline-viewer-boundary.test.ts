// See /tests/README.md#pipeline-viewer-boundary.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');

type Tree = 'astro-core' | 'catalog-format' | 'viewer' | 'pipeline' | 'tooling' | 'other';

// Longest prefix wins, so the tooling roots carve out of scripts/.
const TREE_ROOTS: ReadonlyArray<readonly [string, Tree]> = [
  ['src/astro-core/', 'astro-core'],
  ['src/catalog-format/', 'catalog-format'],
  ['src/client/', 'viewer'],
  ['scripts/perf/', 'tooling'],
  ['scripts/release/', 'tooling'],
  ['scripts/', 'pipeline'],
];

const MAY_IMPORT: Record<Tree, ReadonlySet<Tree> | 'anything'> = {
  'astro-core': new Set(['astro-core']),
  'catalog-format': new Set(['catalog-format', 'astro-core']),
  viewer: new Set(['viewer', 'catalog-format', 'astro-core', 'other']),
  pipeline: new Set(['pipeline', 'catalog-format', 'astro-core', 'other']),
  tooling: 'anything',
  other: 'anything',
};

function treeOf(repoPath: string): Tree {
  const p = repoPath.split(sep).join('/');
  let best: readonly [string, Tree] | undefined;
  for (const entry of TREE_ROOTS) {
    if (p.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best ? best[1] : 'other';
}

const IMPORT_RES = [
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^;'"]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function relativeSpecifiers(src: string): string[] {
  const out: string[] = [];
  for (const re of IMPORT_RES) {
    for (const [, spec] of src.matchAll(re)) if (spec.startsWith('.')) out.push(spec);
  }
  return out;
}

function importTargets(repoPath: string, src: string): string[] {
  return relativeSpecifiers(src).map((spec) => relative(ROOT, resolve(ROOT, dirname(repoPath), spec)));
}

function violations(repoPath: string, src: string): string[] {
  const from = treeOf(repoPath);
  const allowed = MAY_IMPORT[from];
  if (allowed === 'anything') return [];
  return importTargets(repoPath, src)
    .filter((target) => !allowed.has(treeOf(target)))
    .map((target) => `${repoPath} (${from}) imports ${target} (${treeOf(target)})`);
}

const isScannedSource = (p: string) =>
  /\.m?ts$/.test(p) && !/\.test\.m?ts$/.test(p) && !p.endsWith('.d.ts') && !p.endsWith('-fixture.ts');

const scanned = (dir: string) =>
  [...walkFiles(join(ROOT, dir), { include: isScannedSource, skipDir: (n) => n === 'node_modules' })]
    .map((p) => relative(ROOT, p));

describe('pipeline/viewer boundary', () => {
  const files = [...scanned('src'), ...scanned('scripts')];
  const reachesTree = (p: string, tree: Tree) =>
    importTargets(p, readFileSync(join(ROOT, p), 'utf8')).some((t) => treeOf(t) === tree);

  it('every import crosses only in an allowed direction', () => {
    const offenders = files.flatMap((p) => violations(p, readFileSync(join(ROOT, p), 'utf8')));
    expect(offenders).toEqual([]);
  });

  // An exemption nothing uses would let a pipeline module slip into the
  // tooling roots unnoticed; each must still be reaching into the viewer.
  it('each tooling root still imports the viewer', () => {
    for (const root of TREE_ROOTS.filter(([, t]) => t === 'tooling').map(([r]) => r)) {
      expect(files.some((p) => p.startsWith(root) && reachesTree(p, 'viewer')), root).toBe(true);
    }
  });

  it('both sides read the shared trees, so the scan is not vacuous', () => {
    const importers = (tree: Tree, of: Tree) => files.some((p) => treeOf(p) === tree && reachesTree(p, of));
    for (const side of ['viewer', 'pipeline'] as const) {
      expect(importers(side, 'catalog-format'), `${side} → catalog-format`).toBe(true);
      expect(importers(side, 'astro-core'), `${side} → astro-core`).toBe(true);
    }
  });
});

describe('the detector itself', () => {
  it('places each tree by its longest root', () => {
    expect(treeOf('src/astro-core/angles.ts')).toBe('astro-core');
    expect(treeOf('src/catalog-format/record/catalog-pure.ts')).toBe('catalog-format');
    expect(treeOf('src/client/stellata.ts')).toBe('viewer');
    expect(treeOf('scripts/catalog/build-catalog.ts')).toBe('pipeline');
    expect(treeOf('scripts/perf/run.ts')).toBe('tooling');
    expect(treeOf('src/worker.ts')).toBe('other');
  });

  it('catches every import form, type-only included', () => {
    const v = (from: string, src: string) => violations(from, src).length;
    expect(v('scripts/x/a.ts', "import { A } from '../../src/client/b';")).toBe(1);
    expect(v('scripts/x/a.ts', "import type { A } from '../../src/client/b';")).toBe(1);
    expect(v('scripts/x/a.ts', "export { A } from '../../src/client/b';")).toBe(1);
    expect(v('scripts/x/a.ts', "await import('../../src/client/b');")).toBe(1);
    expect(v('scripts/x/a.ts', "import '../../src/client/b';")).toBe(1);
    expect(v('src/client/a.ts', "import { A } from '../../scripts/b';")).toBe(1);
    expect(v('src/catalog-format/a.ts', "import { A } from '../client/b';")).toBe(1);
    expect(v('src/astro-core/a.ts', "import { A } from '../catalog-format/b';")).toBe(1);
  });

  it('leaves the allowed directions and npm packages alone', () => {
    const v = (from: string, src: string) => violations(from, src).length;
    expect(v('src/client/a.ts', "import { A } from '../catalog-format/b';")).toBe(0);
    expect(v('src/client/a.ts', "import { A } from '../astro-core/b';")).toBe(0);
    expect(v('scripts/x/a.ts', "import { A } from '../../src/catalog-format/b';")).toBe(0);
    expect(v('src/catalog-format/a.ts', "import { A } from '../astro-core/b';")).toBe(0);
    expect(v('src/astro-core/a.ts', "import * as THREE from 'three';")).toBe(0);
    expect(v('scripts/perf/a.ts', "import { A } from '../../src/client/b';")).toBe(0);
  });
});
