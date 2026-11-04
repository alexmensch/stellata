// The files build:local-group writes — local-group.json and the lg registry partition its allocation appends to — as its emitArtifacts declaration. See README.md#inputs-and-output.

import { registryFiles } from '../sid/registry-outputs';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { declareOutputs } from '../util/emit-artifacts';
import { publicFile } from '../util/paths';

export const LOCAL_GROUP_OUTPUTS = declareOutputs({
  localGroup: publicFile(SIBLING_ARTIFACTS['local-group'].file),
  ...registryFiles(SIBLING_ARTIFACTS['local-group'].ns),
});
