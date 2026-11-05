// See /tests/README.md#vite-config-import-extensions.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { importSpecifiers, isRelativeSpecifier } from './import-specifiers';

const ROOT = resolve(__dirname, '..');
const CONFIG = resolve(ROOT, 'vite.config.ts');
const CONFIG_ENTRIES = readdirSync(ROOT).filter((name) => /^vite(st)?(\.[\w-]+)?\.config\.m?ts$/.test(name)).sort();

const isWalkable = (p: string) => /\.m?[jt]s$/.test(p);
const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

const staticRelativeImports = (src: string) =>
  importSpecifiers(src).filter(({ spec, kind }) => kind !== 'dynamic import' && isRelativeSpecifier(spec));

function unwrittenPaths(fromFile: string, src: string): string[] {
  return staticRelativeImports(src)
    .map(({ spec }) => spec)
    .filter((spec) => !isFile(resolve(dirname(fromFile), spec)));
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
    for (const spec of unwrittenPaths(file, src)) offenders.push(`${relative(ROOT, file)}: ${spec}`);
    for (const spec of loadedSpecifiers(src)) {
      const target = resolveModule(file, spec);
      if (isWalkable(target)) queue.push(target);
    }
  }
  return { modules: [...seen].map((p) => relative(ROOT, p)).sort(), offenders: offenders.sort() };
}

describe('vite config import extensions', () => {
  it('finds every config Vite or Vitest loads from the repo root', () => {
    expect(CONFIG_ENTRIES).toContain('vite.config.ts');
    expect(CONFIG_ENTRIES).toContain('vite.site.config.ts');
  });

  it.each(CONFIG_ENTRIES)('every relative specifier %s reaches names its file as written', (entry) => {
    expect(walkImportGraph(resolve(ROOT, entry)).offenders).toEqual([]);
  });

  it('the walk reaches past the config into the pipeline modules it imports', () => {
    const { modules } = walkImportGraph(CONFIG);
    expect(modules).toContain('scripts/catalog/build-counts.ts');
    expect(modules).toContain('scripts/util/sources/source.ts');
  });
});

describe('the detector itself', () => {
  const flagged = (src: string) => unwrittenPaths(CONFIG, src);

  it('flags an extensionless relative specifier in every static form, type-only included', () => {
    expect(flagged("import { PUBLIC_DIR } from './scripts/util/paths';")).toEqual(['./scripts/util/paths']);
    expect(flagged("import type { Artifact } from './scripts/util/tsv/artifact-pure';"))
      .toEqual(['./scripts/util/tsv/artifact-pure']);
    expect(flagged("export { x } from './vite.env';")).toEqual(['./vite.env']);
    expect(flagged("import './vite.site-dev';")).toEqual(['./vite.site-dev']);
  });

  it('flags a dotted module name that only looks extensioned', () => {
    expect(flagged("import type { Figures } from './vite.env';")).toEqual(['./vite.env']);
  });

  it('leaves extensioned, package and builtin specifiers alone', () => {
    expect(flagged("import { PUBLIC_DIR } from './scripts/util/paths.ts';")).toEqual([]);
    expect(flagged("import type { Figures } from './vite.env.ts';")).toEqual([]);
    expect(flagged("import { defineConfig } from 'vite';")).toEqual([]);
    expect(flagged("import { resolve } from 'node:path';")).toEqual([]);
  });
});
