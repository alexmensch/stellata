// Every file build:binaries writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../util/emit-artifacts';
import { BUILD_FILES } from '../../src/catalog-format/pipeline-outputs/build-files';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';
import {
  BINDING_LINEAGE, LINEAGE_REPO_LAYOUT, stageFamilies, stageOutputFiles,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const BINARIES_OUTPUTS = declareOutputs({
  multiples: DATA_FILES.multiples,
  bindingVerdicts: BUILD_FILES.bindingVerdicts,
  ...stageOutputFiles(LINEAGE_REPO_LAYOUT, BINDING_LINEAGE),
}, stageFamilies(LINEAGE_REPO_LAYOUT, BINDING_LINEAGE));
