// The binaries astrometry request build:binaries writes, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { sourceIdRequestSource } from '../../catalog/astrometry-request/source-id-request-source';

export const BINARIES_ASTROMETRY_REQUEST = sourceIdRequestSource({
  file: DATA_FILES.binariesAstrometryRequest,
  hint: 'Run `pnpm run build:binaries`.',
});
