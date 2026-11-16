// The two files refresh:iau-wgsn writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const IAU_WGSN_OUTPUTS = declareOutputs({ nec: DATA_FILES.wgsnNec, faints: DATA_FILES.wgsnFaints });
