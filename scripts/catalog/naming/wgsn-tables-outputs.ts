// Every file build:wgsn writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';
import { WGSN_DESIGNATIONS } from './wgsn-designations-tsv';
import { WGSN_NAMES } from './wgsn-names-tsv';

export const WGSN_OUTPUTS = declareOutputs({
  names: resolve(REPO_ROOT, WGSN_NAMES.file),
  designations: resolve(REPO_ROOT, WGSN_DESIGNATIONS.file),
});
