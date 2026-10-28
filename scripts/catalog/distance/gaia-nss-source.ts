// Gaia DR3 NSS two-body source_ids, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseNssSourceIdSet } from './direction-cascade';

const FROM: Declared = {
  file: 'data/gaia/gaia_dr3_nss_two_body.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-nss`.',
};

export const GAIA_NSS = defineSource({
  ...FROM,
  parse: (input) => parseNssSourceIdSet(input.text(), FROM),
});
