// See tests/README.md (source-declarations.test.ts).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declaredInputs, DECLARING_MODULE } from '../scripts/util/sources/declared-inputs';
import { entryClosure, packageScripts } from '../scripts/util/import-closure';
import { scriptParts, tsxEntries } from '../scripts/util/import-closure-pure';
import { REPO_ROOT } from '../scripts/util/paths';
import { isProductionTs, walkFiles } from './walk-files';

const OUT_OF_PIPELINE = /^scripts\/(perf|release|hooks|ci)\//;

/** Modules that call a define* only inside a factory the declaring modules call. */
const DECLARATION_FACTORIES = ['scripts/util/mirror-to-public.ts'];

const scripts = packageScripts();
const MANUAL_TS_STEPS = ['sid:allocate', 'sid:risk-set'];
/** Targets named like steps that are not pipeline steps (Vite is not a step; the seed wrapper runs steps). */
const NOT_STEPS = ['build:client', 'build:site', 'build:seed'];
const STEP_NAMED = Object.keys(scripts)
  .filter((name) => /^(build|fetch):/.test(name) || MANUAL_TS_STEPS.includes(name))
  .filter((name) => !NOT_STEPS.includes(name));
/** Every step with TypeScript in it; an all-`pnpm run` target is an aggregate of steps checked on their own, and an all-Python step records its reads at run time. */
const TS_STEPS = STEP_NAMED.filter((name) => tsxEntries(scripts, name).length > 0);

describe('source declarations', () => {
  it('resolves every step-named script into steps it can check', () => {
    const unresolved = STEP_NAMED.filter((name) => scriptParts(scripts, name).some((p) => p.kind === 'other'));
    expect(unresolved).toEqual([]);
    expect(TS_STEPS).toEqual(expect.arrayContaining(['build:catalog', 'build:local-group', 'build:clouds', 'sid:allocate']));
  });

  it.each(TS_STEPS)('%s reads every source and artifact its import closure reaches', async (step) => {
    const unread = (await declaredInputs(await entryClosure(tsxEntries(scripts, step))))
      .filter(({ use }) => use === 'unused');
    expect(unread.map(({ module, name }) => `${module}#${name}`)).toEqual([]);
  }, 60_000);

  it('names a data/ path only in a declaring or outputs module', () => {
    const offenders: string[] = [];
    for (const file of walkFiles(resolve(REPO_ROOT, 'scripts'), { include: isProductionTs })) {
      const rel = file.slice(REPO_ROOT.length + 1);
      if (OUT_OF_PIPELINE.test(rel)) continue;
      if (DECLARING_MODULE.test(rel) || /-outputs\.ts$/.test(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/^\s*(\*|\/\*)/.test(code)) return;
        if (/['"`]data(\/|['"`])/.test(code)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('declares sources only in a module named for it', () => {
    const misplaced: string[] = [];
    for (const file of walkFiles(resolve(REPO_ROOT, 'scripts'), { include: isProductionTs })) {
      const rel = file.slice(REPO_ROOT.length + 1);
      if (DECLARATION_FACTORIES.includes(rel)) continue;
      if (/\b(defineSource|defineFolder|defineArtifact)\(/.test(readFileSync(file, 'utf8')) && !DECLARING_MODULE.test(rel)) {
        misplaced.push(rel);
      }
    }
    expect(misplaced).toEqual([]);
  });

  it('opens a declared file only inside the sources core', () => {
    const openers: string[] = [];
    for (const root of ['scripts', 'src']) {
      for (const file of walkFiles(resolve(REPO_ROOT, root), { include: isProductionTs })) {
        const rel = file.slice(REPO_ROOT.length + 1);
        if (rel === 'scripts/util/sources/source.ts') continue;
        if (/\bopenDeclared\(/.test(readFileSync(file, 'utf8'))) openers.push(rel);
      }
    }
    expect(openers).toEqual([]);
  });
});
