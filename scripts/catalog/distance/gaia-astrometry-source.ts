// Gaia DR3 5p astrometry, the direction cascade's tier 1, declared.

import { defineSource } from '../../util/sources/source';
import { parseGaiaAstrometryCatalogTsv } from './direction-cascade';

export const GAIA_ASTROMETRY = defineSource({
  file: 'data/gaia/gaia_dr3_astrometry_catalog.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-astrometry-catalog`.',
  parse: (input) => parseGaiaAstrometryCatalogTsv(input.text(), input),
});
