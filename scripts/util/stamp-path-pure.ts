// Where a build step's stamp and lock files live. See README.md (build-stamp.ts entry).

import { resolve } from 'node:path';

import { REPO_ROOT } from './paths';

export const STAMP_FOLDER = 'build/stamps';
export const STAMP_DIR = resolve(REPO_ROOT, STAMP_FOLDER);

/** A step's name as a file name, for its stamp and its lock. */
export const stepFileName = (name: string): string => name.replaceAll(':', '-');

export function stampPath(name: string, root: string = REPO_ROOT): string {
  return resolve(root, STAMP_FOLDER, `${stepFileName(name)}.json`);
}
