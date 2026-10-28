// Gaia DR3 NSS two-body source_ids, declared.

import { defineSource } from '../../util/sources/source';
import { parseNssSourceIdSet } from './direction-cascade';

export const GAIA_NSS = defineSource({
  file: 'data/gaia/gaia_dr3_nss_two_body.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-nss`.',
  parse: (input) => parseNssSourceIdSet(input.text(), input),
});
