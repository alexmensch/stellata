// The files build:clouds writes — clouds.json, the dust bake's column-check inputs, and the cloud registry partition its allocation appends to — as its emitArtifacts declaration. See README.md#outputs.

import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { declareOutputs } from '../util/emit-artifacts';
import { publicFile } from '../util/paths';
import { ZUCKER_PROFILED_SCHEMA } from '../../src/catalog-format/baker-artifacts/baker-artifacts';
import { registryFiles } from '../../src/catalog-format/pipeline-outputs/data-files';

export const CLOUDS_OUTPUTS = declareOutputs({
  clouds: publicFile(SIBLING_ARTIFACTS.clouds.file),
  zuckerProfiled: `data/molecular-clouds/${ZUCKER_PROFILED_SCHEMA.fileName}`,
  ...registryFiles(SIBLING_ARTIFACTS.clouds.ns),
});
