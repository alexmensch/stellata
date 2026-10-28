// Every file build-catalog.ts reads: the content-hash stamp's input set. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { closureWithSiblings } from '../util/import-closure-pure';
import { scriptClosure, trackedFiles } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import { declaredFiles, declaredInputs, isRead } from '../util/sources/declared-inputs';

/** Absolute paths. */
export async function catalogInputPaths(): Promise<string[]> {
  const closure = await scriptClosure(['build:catalog']);
  const data = declaredFiles((await declaredInputs(closure)).filter(isRead))
    .map((file) => resolve(REPO_ROOT, file));
  return [
    ...data,
    ...closureWithSiblings(closure, trackedFiles()).map((path) => resolve(REPO_ROOT, path)),
  ];
}
