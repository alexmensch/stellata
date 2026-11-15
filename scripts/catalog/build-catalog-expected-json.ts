// The count snapshot of build:catalog. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../util/counts/count-stages-pure.ts';
import { defineSnapshot } from '../util/sources/snapshot-pure.ts';

export const BUILD_CATALOG_COUNTS = defineSnapshot<StagedCounts>({
  file: 'scripts/catalog/build-catalog-expected.json',
  script: 'build:catalog',
});
