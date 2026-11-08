// The file each whole-table Gaia pull writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const GAIA_HIP_XMATCH_OUTPUTS = declareOutputs({ xmatch: DATA_FILES.gaiaHipXmatch });
export const GAIA_TYC_XMATCH_OUTPUTS = declareOutputs({ xmatch: DATA_FILES.gaiaTycXmatch });
