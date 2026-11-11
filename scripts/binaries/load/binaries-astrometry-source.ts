// The binaries' Gaia DR3 5p astrometry pull, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { parseGaiaAstrometry } from './gaia-pure';

export const BINARIES_ASTROMETRY = defineSource({
  file: DATA_FILES.gaiaAstrometry,
  hint: 'Re-run `pnpm run refresh:gaia-astrometry`.',
  parse: (input) => parseGaiaAstrometry(input.text(), input),
});
