// Every file build:naming-parity writes, as its emitArtifacts declaration. See README.md#the-parity-ledger.

import { declareOutputs } from '../../util/emit-artifacts';
import { NAMING_DUPLICATES } from './naming-duplicates-tsv';
import { NAMING_PARITY } from './naming-parity-tsv';

export const NAMING_PARITY_OUTPUTS = declareOutputs({
  parity: NAMING_PARITY.file,
  duplicates: NAMING_DUPLICATES.file,
});
