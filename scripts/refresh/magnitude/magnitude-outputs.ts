// The file each magnitude-sliced pull writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const GAIA_MAGNITUDE_OUTPUTS = declareOutputs({ magnitude: DATA_FILES.gaiaMagnitudePull });
export const GAIA_APSIS_OUTPUTS = declareOutputs({ table: DATA_FILES.gaiaApsis });
export const BAILER_JONES_OUTPUTS = declareOutputs({ table: DATA_FILES.bailerJones });
