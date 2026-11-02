// The files sid:stamp writes: the sibling artifacts it rewrites in place and each namespace's registry partition its allocation appends to, as its emitArtifacts declaration. See README.md#sibling-artifact-stamping.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { registryFiles } from './registry-outputs';
import { SIBLING_ARTIFACTS } from './sibling-artifacts';

export const SID_STAMP_OUTPUTS = declareOutputs<string>({
  ...Object.fromEntries(
    Object.entries(SIBLING_ARTIFACTS).map(([name, spec]) => [name, resolve(REPO_ROOT, 'public', spec.file)]),
  ),
  ...Object.assign({}, ...Object.values(SIBLING_ARTIFACTS).map((spec) => registryFiles(spec.ns))),
});
