// The files each whole-table VizieR pull writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const CLASSIC_IDS_OUTPUTS = declareOutputs({
  tyc2Hd: DATA_FILES.tyc2Hd, crossIndex: DATA_FILES.crossIndex, bsc5: DATA_FILES.bsc5, cns5: DATA_FILES.cns5,
});
export const HIP_VMAG_OUTPUTS = declareOutputs({ hipMainVmag: DATA_FILES.hipMainVmag });
export const GLIESE_OUTPUTS = declareOutputs({ gliese: DATA_FILES.gliese });
export const HIP2_OUTPUTS = declareOutputs({ hip2: DATA_FILES.hip2 });
export const MSC_OUTPUTS = declareOutputs({
  systems: DATA_FILES.mscSystems, orbits: DATA_FILES.mscOrbits, components: DATA_FILES.mscComponents,
});
