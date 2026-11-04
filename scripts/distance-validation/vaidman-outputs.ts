// The file build:vaidman-tsv writes, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../util/emit-artifacts';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';

export const VAIDMAN_OUTPUTS = declareOutputs({
  vaidman: DATA_FILES.vaidmanSupergiants,
});
