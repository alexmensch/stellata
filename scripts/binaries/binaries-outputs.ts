// Every file build:binaries writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../util/emit-artifacts';
import { BUILD_FILES } from '../../src/catalog-format/pipeline-outputs/build-files';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';

export const BINARIES_OUTPUTS = declareOutputs({
  multiples: DATA_FILES.multiples,
  astrometryRequest: DATA_FILES.binariesAstrometryRequest,
  bindingVerdicts: BUILD_FILES.bindingVerdicts,
});
