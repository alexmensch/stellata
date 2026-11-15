// The count snapshot of build:membership. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../../util/counts/count-stages-pure';
import { defineSnapshot } from '../../util/sources/snapshot-pure.ts';

export const MEMBERSHIP_COUNTS = defineSnapshot<StagedCounts>({
  file: 'scripts/catalog/membership/membership-manifest-expected.json',
  script: 'build:membership',
});
