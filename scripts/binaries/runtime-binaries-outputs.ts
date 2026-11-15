// Every file build:binaries-runtime writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../util/emit-artifacts';
import { publicFile } from '../util/paths';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';
import {
  LINEAGE_REPO_LAYOUT, RUNTIME_PAIRS_LINEAGE, stageFamilies, stageOutputFiles,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const RUNTIME_BINARIES_OUTPUTS = declareOutputs({
  binaries: publicFile(PUBLIC_FILES.binaries),
  ...stageOutputFiles(LINEAGE_REPO_LAYOUT, RUNTIME_PAIRS_LINEAGE),
}, stageFamilies(LINEAGE_REPO_LAYOUT, RUNTIME_PAIRS_LINEAGE));
