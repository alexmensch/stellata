// See tests/README.md (source-declarations.test.ts).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declaredInputs, DECLARING_MODULE, type DeclaredInput } from '../scripts/util/sources/declared-inputs';
import { scriptClosure } from '../scripts/util/import-closure';
import { tsxEntry } from '../scripts/util/import-closure-pure';
import { escapeRegExp } from '../scripts/util/escape-regexp';
import { PACKAGE_JSON, REPO_ROOT } from '../scripts/util/paths';
import { isProductionTs, walkFiles } from './walk-files';

const OUT_OF_PIPELINE = /^scripts\/(perf|release|hooks|ci)\//;

const { scripts } = JSON.parse(readFileSync(resolve(REPO_ROOT, PACKAGE_JSON), 'utf8')) as {
  scripts: Record<string, string>;
};
const MANUAL_TS_STEPS = ['sid:allocate', 'sid:risk-set'];
const STEPS = Object.keys(scripts)
  .filter((name) => /^tsx \S+\.ts$/.test(scripts[name]))
  .filter((name) => /^(build|fetch):/.test(name) || MANUAL_TS_STEPS.includes(name))
  .filter((name) => !OUT_OF_PIPELINE.test(tsxEntry(scripts, name)));

/** A read or, for an artifact, a write of `input` somewhere in `texts`. */
function touches(input: DeclaredInput, texts: readonly string[]): boolean {
  const n = escapeRegExp(input.name);
  const pattern = input.value.kind === 'source'
    ? new RegExp(`\\b${n}\\.read\\(`)
    : new RegExp(`\\b(readArtifact|artifactRows|artifactText|streamArtifact)\\(\\s*${n}\\b|\\b${n}\\.(serialize|encodeLine)\\(`);
  return texts.some((t) => pattern.test(t));
}

describe('source declarations', () => {
  it.each(STEPS)('%s reads every source and artifact its import closure reaches', async (step) => {
    const closure = await scriptClosure([step]);
    const inputs = await declaredInputs(closure);
    const unread = inputs.filter((input) => {
      const others = [...closure]
        .filter((m) => m !== input.module && m.endsWith('.ts'))
        .map((m) => readFileSync(resolve(REPO_ROOT, m), 'utf8'));
      return !touches(input, others);
    });
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
      if (rel.startsWith('scripts/util/')) continue;
      if (/\b(defineSource|defineArtifact)\(/.test(readFileSync(file, 'utf8')) && !DECLARING_MODULE.test(rel)) {
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
