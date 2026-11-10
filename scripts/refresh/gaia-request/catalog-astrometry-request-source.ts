// The full-catalogue request build:astrometry-request writes, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { sourceIdRequestSource } from '../../catalog/astrometry-request/source-id-request-source';

export const CATALOG_ASTROMETRY_REQUEST = sourceIdRequestSource({
  file: DATA_FILES.astrometryRequest,
  hint: 'Run `pnpm run build:astrometry-request`.',
});
