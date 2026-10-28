// Every file build:local-group reads: the up-to-date gate's input set. See README.md#inputs-and-output.

import { resolve } from 'node:path';

import { closureWithSiblings, tsxEntries } from '../util/import-closure-pure';
import { entryClosure, packageScripts, trackedFiles } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import { declaredFiles, declaredInputs, isRead } from '../util/sources/declared-inputs';

/** Absolute paths: the closure of every tsx entry the target chains, its siblings, and the declarations it reads. */
export async function localGroupInputPaths(): Promise<string[]> {
  const closure = await entryClosure(tsxEntries(packageScripts(), 'build:local-group'));
  return [
    ...declaredFiles((await declaredInputs(closure)).filter(isRead)),
    ...closureWithSiblings(closure, trackedFiles()),
  ].map((path) => resolve(REPO_ROOT, path));
}
