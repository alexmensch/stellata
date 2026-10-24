// The files sid:stamp rewrites in place, as its emitArtifacts declaration. See README.md#sibling-artifact-stamping.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { SIBLING_ARTIFACTS } from './sibling-artifacts';

export const SID_STAMP_OUTPUTS = declareOutputs(Object.fromEntries(
  Object.entries(SIBLING_ARTIFACTS).map(([name, spec]) => [name, resolve(REPO_ROOT, 'public', spec.file)]),
));
