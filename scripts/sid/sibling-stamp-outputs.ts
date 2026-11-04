// The files sid:stamp writes: clouds.json, rewritten in place, and the cloud registry partition its allocation appends to, as its emitArtifacts declaration. See README.md#sibling-artifact-stamping.

import { declareOutputs } from '../util/emit-artifacts';
import { publicFile } from '../util/paths';
import { registryFiles } from './registry-outputs';
import { SIBLING_ARTIFACTS } from './sibling-artifacts-pure';

export const SID_STAMP_OUTPUTS = declareOutputs({
  clouds: publicFile(SIBLING_ARTIFACTS.clouds.file),
  ...registryFiles(SIBLING_ARTIFACTS.clouds.ns),
});
