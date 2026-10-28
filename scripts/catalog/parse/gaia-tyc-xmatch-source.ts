// The Gaia DR3 best-neighbour cross-walk onto TYC, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { streamGaiaTycXmatch } from './gaia-xmatch';

const FROM: Declared = {
  file: 'data/gaia/gaia_dr3_tyc_xmatch.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-tyc`.',
};

export const GAIA_TYC_XMATCH = defineSource({
  ...FROM,
  parse: (input, keep?: ReadonlySet<string>) => streamGaiaTycXmatch(input, FROM, keep),
});
