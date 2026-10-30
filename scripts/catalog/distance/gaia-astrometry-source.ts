// Gaia DR3 5p astrometry, the direction cascade's tier 1, declared.

import { defineSource } from '../../util/sources/source';
import { parseGaiaAstrometryCatalogTsv, type GaiaAstrometryCatalogRow } from './direction-cascade';

export const GAIA_ASTROMETRY = defineSource({
  file: 'data/gaia/gaia_dr3_astrometry_catalog.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-astrometry-catalog`.',
  rowKey: { id: 'gaia-dr3-astrometry', text: (sourceId: string) => sourceId },
  parse: (input): Map<string, GaiaAstrometryCatalogRow> =>
    parseGaiaAstrometryCatalogTsv(input.text(), GAIA_ASTROMETRY),
});
