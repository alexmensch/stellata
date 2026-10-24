// The file sid:risk-set writes, as its emitArtifacts declaration. See README.md.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';

export const DR_RISK_SET_OUTPUTS = declareOutputs({
  request: resolve(REPO_ROOT, 'data/gaia/gaia_dr2_neighbourhood_request.tsv'),
});
