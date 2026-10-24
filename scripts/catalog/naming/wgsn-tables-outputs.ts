// Every file build:wgsn writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';

export const WGSN_OUTPUTS = declareOutputs({
  names: resolve(REPO_ROOT, 'data/iau-wgsn/wgsn_names.tsv'),
  designations: resolve(REPO_ROOT, 'data/iau-wgsn/wgsn_designations.tsv'),
});
