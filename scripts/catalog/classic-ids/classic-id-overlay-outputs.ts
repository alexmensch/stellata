// Every file build:classic-ids writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { declareOutputs } from '../../util/emit-artifacts';
import {
  CLASSIC_IDS_LINEAGE, LINEAGE_REPO_LAYOUT, stageFamilies, stageOutputFiles,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';

export const CLASSIC_ID_OUTPUTS = declareOutputs({
  overlay: DATA_FILES.classicIdOverlay,
  disagreements: DATA_FILES.routeDisagreements,
  rejected: DATA_FILES.rejectedBindings,
  ...stageOutputFiles(LINEAGE_REPO_LAYOUT, CLASSIC_IDS_LINEAGE),
}, stageFamilies(LINEAGE_REPO_LAYOUT, CLASSIC_IDS_LINEAGE));
