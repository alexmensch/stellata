// The binaries' Gaia DR3 5p astrometry pull, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { parseGaiaAstrometryCatalogTsv, type GaiaAstrometryCatalogRow } from '../../catalog/sources/gaia-astrometry-source';
import { defineSource } from '../../util/sources/source';

export const BINARIES_ASTROMETRY = defineSource({
  file: DATA_FILES.gaiaAstrometry,
  hint: 'Re-run `pnpm run refresh:gaia-astrometry`.',
  rowKey: { id: 'gaia-dr3-astrometry-binaries', text: (sourceId: string) => sourceId },
  parse: (input): Map<string, GaiaAstrometryCatalogRow> =>
    parseGaiaAstrometryCatalogTsv(input.text(), BINARIES_ASTROMETRY),
});
