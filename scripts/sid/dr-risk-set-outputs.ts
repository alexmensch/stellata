// The file sid:risk-set writes, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';

export const DR_RISK_SET_OUTPUTS = declareOutputs({
  request: 'build/sid/dr-risk-set-request.tsv',
});
