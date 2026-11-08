// The binaries' Gaia DR3 5p astrometry pull, declared.

import { defineSource } from '../../util/sources/source';
import { parseGaiaAstrometry } from './gaia-pure';

export const BINARIES_ASTROMETRY = defineSource({
  file: 'data/gaia/gaia_dr3_astrometry.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-astrometry`.',
  parse: (input) => parseGaiaAstrometry(input.text(), input),
});
