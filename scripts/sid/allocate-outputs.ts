// The files sid:allocate writes, as its output declaration. See README.md.

import { resolve } from 'node:path';

import { declareOutputs } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';

export const ALLOCATE_OUTPUTS = declareOutputs({
  ledger: resolve(REPO_ROOT, 'data/sid/ledger.tsv'),
  head: resolve(REPO_ROOT, 'data/sid/ledger-head.json'),
});
