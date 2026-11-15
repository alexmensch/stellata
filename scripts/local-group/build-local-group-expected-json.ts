// The count snapshot of build:local-group. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../util/counts/count-stages-pure';
import { SIBLING_ARTIFACTS } from '../sid/sibling-artifacts-pure';
import { defineSnapshot } from '../util/sources/snapshot-pure.ts';

export const LOCAL_GROUP_COUNTS = defineSnapshot<StagedCounts>({
  file: 'scripts/local-group/build-local-group-expected.json',
  script: SIBLING_ARTIFACTS['local-group'].step,
});
