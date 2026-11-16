// The file refresh:simbad-tyc-hd writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const SIMBAD_TYC_HD_OUTPUTS = declareOutputs({ tycHd: DATA_FILES.simbadTycHd });
