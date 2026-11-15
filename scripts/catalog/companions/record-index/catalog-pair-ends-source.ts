// build/catalog-pair-ends.json, the pair ends build:catalog writes, declared for build:binaries-runtime.

import { BUILD_FILES } from '../../../../src/catalog-format/pipeline-outputs/build-files';
import { defineSource } from '../../../util/sources/source';
import { parseCatalogPairEnds } from './pair-ends-pure';

export const CATALOG_PAIR_ENDS = defineSource({
  file: BUILD_FILES.catalogPairEnds,
  hint: 'Re-run `pnpm run build:catalog`.',
  parse: (input) => parseCatalogPairEnds(input.text()),
});
