// Gaia DR3 synthetic photometry, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseGspcTsv } from './gspc-parse';

const FROM: Declared = {
  file: 'data/gaia/gaia_dr3_gspc.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-gspc`.',
};

export const GAIA_GSPC = defineSource({
  ...FROM,
  parse: (input) => parseGspcTsv(input.text(), FROM),
});
