// The file lineage:codes writes, as its emitArtifacts declaration. See README.md.

import { declareOutputs } from '../../../util/emit-artifacts';
import { DATA_FILES } from '../../../../src/catalog-format/pipeline-outputs/data-files';

export const REASON_CODES_OUTPUTS = declareOutputs({ codes: DATA_FILES.reasonCodes });
