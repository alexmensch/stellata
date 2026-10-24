// The file build:local-group writes, as its emitArtifacts declaration. See README.md#inputs-and-output.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';

export const LOCAL_GROUP_OUTPUTS = declareOutputs({
  localGroup: resolve(REPO_ROOT, 'public/local-group.json'),
});
