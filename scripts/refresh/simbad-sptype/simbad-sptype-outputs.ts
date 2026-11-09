// The file refresh:simbad-sptype writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const SIMBAD_SPTYPE_OUTPUTS = declareOutputs({ sptype: DATA_FILES.simbadSptype });
