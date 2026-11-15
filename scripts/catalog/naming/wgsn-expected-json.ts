// The count snapshot of build:wgsn. See /scripts/util/sources/README.md#a-snapshot.

import type { WgsnCounts } from './build-wgsn-tables';
import { defineSnapshot } from '../../util/sources/snapshot-pure.ts';

export const WGSN_COUNTS = defineSnapshot<WgsnCounts>({
  file: 'scripts/catalog/naming/wgsn-expected.json',
  script: 'build:wgsn',
});
