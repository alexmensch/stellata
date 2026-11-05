// See /tests/README.md#vite-config-import-extensions.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { importSpecifiers, isRelativeSpecifier } from './import-specifiers';

const ROOT = resolve(__dirname, '..');
const CONFIG = resolve(ROOT, 'vite.config.ts');

const isWalkable = (p: string) => /\.m?[jt]s$/.test(p);
const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

const staticRelativeImports = (src: string) =>
  importSpecifiers(src).filter(({ spec, kind }) => kind !== 'dynamic import' && isRelativeSpecifier(spec));

function extensionlessSpecifiers(src: string): string[] {
  return staticRelativeImports(src).map(({ spec }) => spec).filter((spec) => extname(spec) === '');
}

const loadedSpecifiers = (src: string) =>
  staticRelativeImports(src).filter(({ typeOnly }) => !typeOnly).map(({ spec }) => spec);

function resolveModule(fromFile: string, spec: string): string {
  const base = resolve(dirname(fromFile), spec);
  const candidates = extname(spec) === '' ? [`${base}.ts`, `${base}.mts`, resolve(base, 'index.ts')] : [base];
  const hit = candidates.find(isFile);
  if (hit === undefined) throw new Error(`${relative(ROOT, fromFile)}: cannot resolve ${spec}`);
  return hit;
}

function walkImportGraph(entry: string): { modules: string[]; offenders: string[] } {
  const seen = new Set<string>();
  const offenders: string[] = [];
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const spec of extensionlessSpecifiers(src)) offenders.push(`${relative(ROOT, file)}: ${spec}`);
    for (const spec of loadedSpecifiers(src)) {
      const target = resolveModule(file, spec);
      if (isWalkable(target)) queue.push(target);
    }
  }
  return { modules: [...seen].map((p) => relative(ROOT, p)).sort(), offenders: offenders.sort() };
}

describe('vite config import extensions', () => {
  const { modules, offenders } = walkImportGraph(CONFIG);

  it('every relative specifier the config reaches carries its file extension', () => {
    expect(offenders).toEqual([]);
  });

  it('the walk reaches past the config into the pipeline modules it imports', () => {
    expect(modules).toContain('scripts/catalog/build-counts.ts');
    expect(modules).toContain('scripts/util/sources/source.ts');
  });
});

describe('the detector itself', () => {
  it('flags an extensionless relative specifier in every static form, type-only included', () => {
    expect(extensionlessSpecifiers("import { REPO_ROOT } from '../util/paths';")).toEqual(['../util/paths']);
    expect(extensionlessSpecifiers("import type { Artifact } from '../tsv/artifact-pure';"))
      .toEqual(['../tsv/artifact-pure']);
    expect(extensionlessSpecifiers("export { x } from './x';")).toEqual(['./x']);
    expect(extensionlessSpecifiers("import './side-effect';")).toEqual(['./side-effect']);
  });

  it('leaves extensioned, package and builtin specifiers alone', () => {
    expect(extensionlessSpecifiers("import { REPO_ROOT } from '../util/paths.ts';")).toEqual([]);
    expect(extensionlessSpecifiers("import { defineConfig } from 'vite';")).toEqual([]);
    expect(extensionlessSpecifiers("import { resolve } from 'node:path';")).toEqual([]);
  });
});
