// The file refresh:simbad-wds-xids writes, as its emitArtifacts declaration. See README.md.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const SIMBAD_WDS_XIDS_OUTPUTS = declareOutputs({ xids: DATA_FILES.simbadWdsXids });
