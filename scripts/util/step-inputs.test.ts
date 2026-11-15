import { relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STEPS } from '../pipeline/step-table/steps';
import { gitFiles } from './git-files';
import { entryClosure } from './import-closure';
import { REPO_ROOT } from './paths';
import { declaredFiles, declaredInputs, isRead } from './sources/declared-inputs';
import { SNAPSHOT_MODULE_SUFFIX, type Snapshot } from './sources/snapshot-pure';
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

const snapshotModules = await Promise.all(gitFiles(REPO_ROOT, [`scripts/**/*${SNAPSHOT_MODULE_SUFFIX}`]).map(async (module) =>
  ({ module, exported: Object.values(await import(resolve(REPO_ROOT, module)) as Record<string, unknown>) })));

const declarations = snapshotModules.flatMap(({ exported }) => exported as Snapshot<unknown>[]);

describe('entryInputPaths over every TypeScript step', () => {
  it('finds each snapshot module exporting one snapshot and nothing else, since naming its export is what reads it', () => {
    expect(snapshotModules.map(({ module, exported }) => ({ module, kinds: exported.map((v) => (v as { kind?: unknown }).kind) })))
      .toEqual(snapshotModules.map(({ module }) => ({ module, kinds: ['snapshot'] })));
  });

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
});
