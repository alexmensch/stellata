// The file build:lut writes, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';

export const LUT_OUTPUTS = declareOutputs({
  lut: 'src/client/star-pipeline/blackbody-lut-data.ts',
});
