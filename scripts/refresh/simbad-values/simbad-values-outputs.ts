// The file refresh:simbad-values writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const SIMBAD_VALUES_OUTPUTS = declareOutputs({ values: DATA_FILES.simbadValues });
