// The files sid:stamp writes: clouds.json, rewritten in place, and the cloud registry partition its allocation appends to, as its emitArtifacts declaration. See README.md#sibling-artifact-stamping.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { registryFiles } from './registry-outputs';
import { SIBLING_ARTIFACTS } from './sibling-artifacts-pure';

export const SID_STAMP_OUTPUTS = declareOutputs({
  clouds: resolve(REPO_ROOT, 'public', SIBLING_ARTIFACTS.clouds.file),
  ...registryFiles(SIBLING_ARTIFACTS.clouds.ns),
});
