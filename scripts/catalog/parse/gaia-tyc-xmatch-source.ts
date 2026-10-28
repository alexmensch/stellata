// The Gaia DR3 best-neighbour cross-walk onto TYC, declared.

import { defineSource } from '../../util/sources/source';
import { streamGaiaTycXmatch } from './gaia-xmatch';

export const GAIA_TYC_XMATCH = defineSource({
  file: 'data/gaia/gaia_dr3_tyc_xmatch.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-tyc`.',
  parse: (input, keep?: ReadonlySet<string>) => streamGaiaTycXmatch(input, keep),
});
