// build/catalog-row-index-map.json, the sidecar build:catalog writes, declared for its readers.

import { BUILD_FILES } from '../../../../src/catalog-format/pipeline-outputs/build-files';
import { defineSource } from '../../../util/sources/source';
import { parseCatalogRowIndexMap } from './catalog-row-index-map-pure';

export const CATALOG_ROW_INDEX_MAP = defineSource({
  file: BUILD_FILES.catalogRowIndexMap,
  hint: 'Re-run `pnpm run build:catalog`.',
  parse: (input) => parseCatalogRowIndexMap(input.text()),
});
