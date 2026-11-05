// Every declareOutputs constant under scripts/ belongs to a step on the table or a non-step writer. See ../scripts/pipeline/README.md#the-model.

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { NON_STEP_WRITERS } from '../scripts/pipeline/step-table/non-step-writers';
import { STEPS } from '../scripts/pipeline/step-table/steps';
import { packageScripts } from '../scripts/util/import-closure';
import { scriptParts } from '../scripts/util/import-closure-pure';
import { REPO_ROOT } from '../scripts/util/paths';
import { isProductionTs, walkFiles } from './walk-files';

type Ref = `${string}#${string}`;

const DEFINITION = 'scripts/util/emit-artifacts.ts';
const OUTPUTS_MODULE = /-outputs\.ts$/;
const CALL = /\bdeclareOutputs\(/g;
const RUNNER = 'scripts/pipeline/run.ts';

const isDeclaredOutputs = (value: unknown): boolean => typeof value === 'object' && value !== null
  && 'files' in value && 'families' in value && Array.isArray(value.families);

const calling = [...walkFiles(`${REPO_ROOT}/scripts`, { include: isProductionTs })]
  .map((file) => ({ module: relative(REPO_ROOT, file), calls: readFileSync(file, 'utf8').match(CALL)?.length ?? 0 }))
  .filter(({ module, calls }) => calls > 0 && module !== DEFINITION);

async function exported(module: string): Promise<Ref[]> {
  const exports = await import(resolve(REPO_ROOT, module)) as Record<string, unknown>;
  return Object.entries(exports).flatMap(([name, value]) => (isDeclaredOutputs(value) ? [`${module}#${name}` as Ref] : []));
}

const tableRefs = new Set<Ref>(STEPS.steps.flatMap((s) => (
  s.language === 'ts' ? [`${s.outputs.module}#${s.outputs.name}` as Ref] : []
)));
const writerRefs = new Set<Ref>(Object.values(NON_STEP_WRITERS).flatMap((w) => (
  'outputs' in w ? w.outputs.map(({ module, name }) => `${module}#${name}` as Ref) : []
)));

describe('declareOutputs coverage', () => {
  it('calls declareOutputs only in an outputs module, and exports every call', async () => {
    expect(calling.filter(({ module }) => !OUTPUTS_MODULE.test(module)).map(({ module }) => module)).toEqual([]);
    const unexported: string[] = [];
    for (const { module, calls } of calling) {
      if ((await exported(module)).length !== calls) unexported.push(module);
    }
    expect(unexported).toEqual([]);
  });

  it('places every constant on the table or with a non-step writer, and names only constants that exist, once', async () => {
    const found = new Set((await Promise.all(calling.map(({ module }) => exported(module)))).flat());
    expect(found.size).toBeGreaterThan(tableRefs.size);
    expect([...found].filter((ref) => !tableRefs.has(ref) && !writerRefs.has(ref))).toEqual([]);
    const listed = [...tableRefs, ...writerRefs];
    expect(listed.filter((ref) => !found.has(ref))).toEqual([]);
    expect(listed.filter((ref, i) => listed.indexOf(ref) !== i)).toEqual([]);
  });

  it('keys the non-step writers on package.json scripts off the table', () => {
    const scripts = packageScripts();
    const tableNames = new Set(STEPS.steps.map((s) => s.name));
    const names = Object.keys(NON_STEP_WRITERS);
    expect(names.filter((name) => !(name in scripts))).toEqual([]);
    expect(names.filter((name) => tableNames.has(name))).toEqual([]);
  });

  it('places every step-named script on the table, among the non-step writers, or as a run of the runner', () => {
    const scripts = packageScripts();
    const tableNames = new Set(STEPS.steps.map((s) => s.name));
    const runsRunner = (name: string): boolean => scriptParts(scripts, name)
      .every((p) => p.kind === 'tsx' && p.entry === RUNNER);
    const unplaced = Object.keys(scripts).filter((name) => /^(build|fetch|refresh):/.test(name))
      .filter((name) => !tableNames.has(name) && !(name in NON_STEP_WRITERS) && !runsRunner(name));
    expect(unplaced).toEqual([]);
  });
});
