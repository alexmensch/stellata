// The files build:local-group writes — local-group.json and the lg registry partition its allocation appends to — as its emitArtifacts declaration. See README.md#inputs-and-output.

import { resolve } from 'node:path';

import { registryFiles } from '../sid/registry-outputs';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';

export const LOCAL_GROUP_OUTPUTS = declareOutputs({
  localGroup: resolve(REPO_ROOT, 'public', SIBLING_ARTIFACTS['local-group'].file),
  ...registryFiles(SIBLING_ARTIFACTS['local-group'].ns),
});
