// The file sid:dr-reconcile writes, as its emitArtifacts declaration. See README.md.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';

export const DR_RECONCILE_OUTPUTS = declareOutputs({
  bridges: resolve(REPO_ROOT, 'build/sid/dr-reconcile-bridges.tsv'),
});
