// Every file build:naming-parity writes, as its emitArtifacts declaration. See README.md#the-parity-ledger.

import { resolve } from 'node:path';

import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';
import { NAMING_DUPLICATES } from './naming-duplicates-tsv';
import { NAMING_PARITY } from './naming-parity-tsv';

export const NAMING_PARITY_OUTPUTS = declareOutputs({
  parity: resolve(REPO_ROOT, NAMING_PARITY.file),
  duplicates: resolve(REPO_ROOT, NAMING_DUPLICATES.file),
});
