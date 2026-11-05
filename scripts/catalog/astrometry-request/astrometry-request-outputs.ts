// The file build:astrometry-request writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const ASTROMETRY_REQUEST_OUTPUTS = declareOutputs({
  request: DATA_FILES.astrometryRequest,
});
