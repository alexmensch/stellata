// The file sid:dr-reconcile writes, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';

export const DR_RECONCILE_OUTPUTS = declareOutputs({
  bridges: 'build/sid/dr-reconcile-bridges.tsv',
});
