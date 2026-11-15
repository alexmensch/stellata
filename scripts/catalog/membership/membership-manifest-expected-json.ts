// The count snapshot of build:membership. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../../util/counts/count-stages-pure';
import { defineSnapshot } from '../../util/sources/snapshot-pure.ts';
import { MEMBERSHIP_EXPECTED_FILE } from './membership-manifest-pure';

export const MEMBERSHIP_COUNTS = defineSnapshot<StagedCounts>({
  file: MEMBERSHIP_EXPECTED_FILE,
  script: 'build:membership',
});
