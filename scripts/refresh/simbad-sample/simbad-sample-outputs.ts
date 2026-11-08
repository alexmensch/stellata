// The file refresh:simbad writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const SIMBAD_SAMPLE_OUTPUTS = declareOutputs({ sample: DATA_FILES.simbadSample });
