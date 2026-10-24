// The file build:lut writes, as its emitArtifacts declaration. See README.md.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';

export const LUT_OUTPUTS = declareOutputs({
  lut: resolve(REPO_ROOT, 'src/client/star-pipeline/blackbody-lut-data.ts'),
});
