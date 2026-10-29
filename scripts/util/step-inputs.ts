// Every file a package.json step reads: its import closure, the closure's siblings, and the declarations it reads. See README.md.

import { resolve } from 'node:path';

import { closureWithSiblings, tsxEntries } from './import-closure-pure';
import { entryClosure, packageScripts, trackedFiles } from './import-closure';
import { REPO_ROOT } from './paths';
import { declaredFiles, declaredInputs, isRead } from './sources/declared-inputs';

/** Absolute paths, over every tsx entry the script chains. */
export async function stepInputPaths(script: string): Promise<string[]> {
  const closure = await entryClosure(tsxEntries(packageScripts(), script));
  return [
    ...declaredFiles((await declaredInputs(closure)).filter(isRead)),
    ...closureWithSiblings(closure, trackedFiles()),
  ].map((path) => resolve(REPO_ROOT, path));
}
