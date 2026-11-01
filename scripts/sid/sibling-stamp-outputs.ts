// The files sid:stamp writes: the sibling artifacts it rewrites in place and the registry its allocation appends to, as its emitArtifacts declaration. See README.md#sibling-artifact-stamping.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { REGISTRY_FILES } from './registry-outputs';
import { SIBLING_ARTIFACTS } from './sibling-artifacts';

export const SID_STAMP_OUTPUTS = declareOutputs<string>({
  ...Object.fromEntries(
    Object.entries(SIBLING_ARTIFACTS).map(([name, spec]) => [name, resolve(REPO_ROOT, 'public', spec.file)]),
  ),
  ...REGISTRY_FILES,
});
