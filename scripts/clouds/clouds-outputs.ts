// The files build:clouds writes — clouds.json, the dust bake's column-check inputs, and the cloud registry partition its allocation appends to, and that allocation's lineage stage — as its emitArtifacts declaration. See README.md#outputs.

import { declareOutputs } from '../util/emit-artifacts';
import { publicFile } from '../util/paths';
import { ZUCKER_PROFILED_SCHEMA } from '../../src/catalog-format/baker-artifacts/baker-artifacts';
import { CLOUD_PARTITION, registryFiles } from '../../src/catalog-format/pipeline-outputs/data-files';
import { PUBLIC_FILES } from '../../src/catalog-format/public-artifacts/public-artifacts';
import {
  CLOUDS_ALLOCATION_LINEAGE, LINEAGE_REPO_LAYOUT, stageFamilies, stageOutputFiles,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

export const CLOUDS_OUTPUTS = declareOutputs({
  clouds: publicFile(PUBLIC_FILES.clouds),
  zuckerProfiled: `data/molecular-clouds/${ZUCKER_PROFILED_SCHEMA.fileName}`,
  ...registryFiles(CLOUD_PARTITION),
  ...stageOutputFiles(LINEAGE_REPO_LAYOUT, CLOUDS_ALLOCATION_LINEAGE),
}, stageFamilies(LINEAGE_REPO_LAYOUT, CLOUDS_ALLOCATION_LINEAGE));
