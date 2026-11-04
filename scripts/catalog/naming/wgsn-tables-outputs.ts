// Every file build:wgsn writes, as its emitArtifacts declaration. See README.md#files-in-this-area.

import { declareOutputs } from '../../util/emit-artifacts';

export const WGSN_NAMES_FILE = 'data/iau-wgsn/wgsn_names.tsv';
export const WGSN_DESIGNATIONS_FILE = 'data/iau-wgsn/wgsn_designations.tsv';

export const WGSN_OUTPUTS = declareOutputs({
  names: WGSN_NAMES_FILE,
  designations: WGSN_DESIGNATIONS_FILE,
});
