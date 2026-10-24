// Every file build:naming-parity writes, as its emitArtifacts declaration. See README.md#the-parity-ledger.

import { resolve } from 'node:path';

import { declareOutputs } from '../../util/emit-artifacts';
import { REPO_ROOT } from '../../util/paths';

export const NAMING_PARITY_OUTPUTS = declareOutputs({
  parity: resolve(REPO_ROOT, 'scripts/catalog/naming/naming-parity.tsv'),
  duplicates: resolve(REPO_ROOT, 'scripts/catalog/naming/naming-duplicates.tsv'),
});
