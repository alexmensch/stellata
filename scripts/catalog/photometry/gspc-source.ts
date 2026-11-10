// Gaia DR3 synthetic photometry, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseGspcTsv, type GspcColour } from './gspc-parse';

export const GAIA_GSPC = defineSource({
  file: DATA_FILES.gaiaGspc,
  hint: 'Re-run `pnpm run refresh:gaia-gspc`.',
  rowKey: { id: 'gaia-dr3-gspc', text: (sourceId: string) => sourceId },
  parse: (input): Map<string, GspcColour> => parseGspcTsv(input.text(), GAIA_GSPC),
});
