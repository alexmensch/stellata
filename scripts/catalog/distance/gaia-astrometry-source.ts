// Gaia DR3 5p astrometry, the direction cascade's tier 1, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { parseGaiaAstrometryCatalogTsv } from './direction-cascade';

const FROM: Declared = {
  file: 'data/gaia/gaia_dr3_astrometry_catalog.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-astrometry-catalog`.',
};

export const GAIA_ASTROMETRY = defineSource({
  ...FROM,
  parse: (input) => parseGaiaAstrometryCatalogTsv(input.text(), FROM),
});
