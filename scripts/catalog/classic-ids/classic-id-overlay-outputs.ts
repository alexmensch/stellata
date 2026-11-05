// Every file build:classic-ids writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';

export const CLASSIC_ID_OUTPUTS = declareOutputs({
  overlay: DATA_FILES.classicIdOverlay,
  disagreements: DATA_FILES.routeDisagreements,
  rejected: DATA_FILES.rejectedBindings,
});
