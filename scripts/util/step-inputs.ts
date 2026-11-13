// Every file a step reads: its import closure, the closure's siblings, and the declarations it reads. See README.md.

import { resolve } from 'node:path';

import { STEPS } from '../pipeline/step-table/steps';
import { closureWithSiblings, tsxEntries } from './import-closure-pure';
import { entryClosure, packageScripts, trackedFiles } from './import-closure';
import { REPO_ROOT } from './paths';
import { declaredFiles, declaredInputs, isRead } from './sources/declared-inputs';

/** Repo-relative: a build step's entry, or every tsx entry an
 *  off-table package.json script chains. */
export function stepEntries(name: string): string[] {
  const step = STEPS.steps.find((s) => s.name === name);
  if (step === undefined) return tsxEntries(packageScripts(), name);
  return step.kind === 'build' ? [step.entry] : [];
}

/** Absolute paths. */
export async function stepInputPaths(name: string): Promise<string[]> {
  return entryInputPaths(stepEntries(name));
}

/** Absolute paths, over the given entry files. */
export async function entryInputPaths(entries: readonly string[]): Promise<string[]> {
  const closure = await entryClosure(entries);
  return [
    ...declaredFiles((await declaredInputs(closure)).filter(isRead)),
    ...closureWithSiblings(closure, trackedFiles()),
  ].map((path) => resolve(REPO_ROOT, path));
}
