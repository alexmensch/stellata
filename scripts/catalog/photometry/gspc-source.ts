// Gaia DR3 synthetic photometry, declared.

import { defineSource } from '../../util/sources/source';
import { parseGspcTsv } from './gspc-parse';

export const GAIA_GSPC = defineSource({
  file: 'data/gaia/gaia_dr3_gspc.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-gspc`.',
  parse: (input) => parseGspcTsv(input.text(), input),
});
