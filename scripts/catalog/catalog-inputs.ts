// Every file build-catalog.ts reads: the content-hash stamp's input set. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { closureWithSiblings } from '../util/import-closure-pure';
import { scriptClosure, trackedFiles } from '../util/import-closure';
import { REPO_ROOT } from '../util/paths';
import { declaredFiles, declaredInputs } from '../util/sources/declared-inputs';
import {
  OVERRIDES_PATH, REINSTATEMENTS_PATH, RETIREMENTS_PATH,
} from '../sid/registry-io';
import { CATALOG_OUTPUTS } from './catalog-outputs';

/** Absolute paths. */
export async function catalogInputPaths(): Promise<string[]> {
  const closure = await scriptClosure(['build:catalog']);
  const outputs = new Set(Object.values(CATALOG_OUTPUTS.files));
  const data = declaredFiles(await declaredInputs(closure))
    .map((file) => resolve(REPO_ROOT, file))
    .filter((path) => !outputs.has(path));
  return [
    ...data,
    OVERRIDES_PATH, RETIREMENTS_PATH, REINSTATEMENTS_PATH,
    ...closureWithSiblings(closure, trackedFiles()).map((path) => resolve(REPO_ROOT, path)),
  ];
}
