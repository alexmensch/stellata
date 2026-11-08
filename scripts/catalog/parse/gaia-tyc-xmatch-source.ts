// The Gaia DR3 best-neighbour cross-walk onto TYC, declared.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { streamGaiaTycXmatch } from './gaia-xmatch';

export const GAIA_TYC_XMATCH = defineSource({
  file: DATA_FILES.gaiaTycXmatch,
  hint: 'Re-run `pnpm run refresh:gaia-tyc`.',
  parse: (input, keep?: ReadonlySet<string>) => streamGaiaTycXmatch(input, keep),
});
