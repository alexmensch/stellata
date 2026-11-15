import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STEPS } from '../pipeline/step-table/steps';
import { gitFiles } from './git-files';
import { entryClosure } from './import-closure';
import { REPO_ROOT } from './paths';
import { declaredFiles, declaredInputs, isRead } from './sources/declared-inputs';
import type { Snapshot } from './sources/snapshot-pure';
import { entryInputPaths } from './step-inputs';

const rel = (path: string): string => relative(REPO_ROOT, path);

const steps = await Promise.all(STEPS.steps.filter((s) => s.language === 'ts').map(async (step) => {
  const closure = await entryClosure([step.entry]);
  return {
    name: step.name,
    closure,
    reads: new Set(declaredFiles((await declaredInputs(closure)).filter(isRead))),
    inputs: (await entryInputPaths([step.entry])).map(rel),
  };
}));

const keyedBy = (file: string): string[] => steps.filter((s) => s.inputs.includes(file)).map((s) => s.name);

const declarations = await Promise.all(gitFiles(REPO_ROOT, ['scripts/**/*-expected-json.ts']).map(async (module) =>
  Object.values(await import(resolve(REPO_ROOT, module)) as Record<string, Snapshot<unknown>>)[0]));

describe('entryInputPaths over every TypeScript step', () => {
  it('keys only what the closure imports and the declarations it reads', () => {
    const stray = steps.flatMap((s) => s.inputs
      .filter((p) => !s.closure.has(p) && !s.reads.has(p))
      .map((p) => `${s.name}: ${p}`));
    expect(stray).toEqual([]);
  });

  it('keys each declared snapshot in exactly the step its declaration names', () => {
    expect(declarations.map((d) => ({ file: d.file, keyedBy: keyedBy(d.file) })))
      .toEqual(declarations.map((d) => ({ file: d.file, keyedBy: [d.script] })));
  });

  it('keys no snapshot that has no declaration', () => {
    const declared = new Set(declarations.map((d) => d.file));
    const undeclared = gitFiles(REPO_ROOT, ['scripts/**/*-expected.json']).filter((f) => !declared.has(f));
    expect(undeclared.map((file) => ({ file, keyedBy: keyedBy(file) })))
      .toEqual(undeclared.map((file) => ({ file, keyedBy: [] })));
  });

  it('keys no file a step neither imports nor reads, wherever it sits beside one\'s code', () => {
    const fixtures = [
      'scripts/catalog/naming/naming-parity.tsv',
      'scripts/catalog/naming/naming-duplicates.tsv',
      'scripts/catalog/companions/multi-star-regression.tsv',
      'scripts/catalog/validate/known-stars.tsv',
      'scripts/textures/requirements.txt',
    ];
    expect(fixtures.map((file) => ({ file, keyedBy: keyedBy(file) })))
      .toEqual(fixtures.map((file) => ({ file, keyedBy: [] })));
  });
});
