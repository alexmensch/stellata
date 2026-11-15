// The count snapshot of build:local-group. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../util/counts/count-stages-pure';
import { defineSnapshot } from '../util/sources/snapshot-pure.ts';

export const LOCAL_GROUP_COUNTS = defineSnapshot<StagedCounts>({
  file: 'scripts/local-group/build-local-group-expected.json',
  script: 'build:local-group',
});
