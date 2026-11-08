// Gaia DR3 synthetic photometry, declared.

import { defineSource } from '../../util/sources/source';
import { parseGspcTsv, type GspcColour } from './gspc-parse';

export const GAIA_GSPC = defineSource({
  file: 'data/gaia/gaia_dr3_gspc.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-gspc`.',
  rowKey: { id: 'gaia-dr3-gspc', text: (sourceId: string) => sourceId },
  parse: (input): Map<string, GspcColour> => parseGspcTsv(input.text(), GAIA_GSPC),
});
