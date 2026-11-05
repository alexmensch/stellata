// Every file build:wgsn writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const WGSN_OUTPUTS = declareOutputs({
  names: DATA_FILES.wgsnNames,
  designations: DATA_FILES.wgsnDesignations,
});
