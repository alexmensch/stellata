// The file each request-scoped Gaia pull writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const GAIA_ASTROMETRY_OUTPUTS = declareOutputs({ astrometry: DATA_FILES.gaiaAstrometry });
export const GAIA_GSPC_OUTPUTS = declareOutputs({ gspc: DATA_FILES.gaiaGspc });
export const GAIA_DR2_NEIGHBOURHOOD_OUTPUTS = declareOutputs({ neighbourhood: DATA_FILES.gaiaDr2Neighbourhood });
