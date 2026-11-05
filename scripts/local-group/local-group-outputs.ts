// The files build:local-group writes — local-group.json and the lg registry partition its allocation appends to, and that allocation's lineage stage — as its emitArtifacts declaration. See README.md#inputs-and-output.

import { declareOutputs } from '../util/emit-artifacts';
import { publicFile } from '../util/paths';
import { LOCAL_GROUP_PARTITION, registryFiles } from '../../src/catalog-format/pipeline-outputs/data-files';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';
import {
  LOCAL_GROUP_ALLOCATION_LINEAGE, LINEAGE_REPO_LAYOUT, stageFamilies, stageOutputFiles,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const LOCAL_GROUP_OUTPUTS = declareOutputs({
  localGroup: publicFile(PUBLIC_FILES.localGroup),
  ...registryFiles(LOCAL_GROUP_PARTITION),
  ...stageOutputFiles(LINEAGE_REPO_LAYOUT, LOCAL_GROUP_ALLOCATION_LINEAGE),
}, stageFamilies(LINEAGE_REPO_LAYOUT, LOCAL_GROUP_ALLOCATION_LINEAGE));
