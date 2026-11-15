// The count snapshot of build:classic-ids. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../../util/counts/count-stages-pure';
import { defineSnapshot } from '../../util/sources/snapshot-pure.ts';

export const CLASSIC_ID_OVERLAY_COUNTS = defineSnapshot<StagedCounts>({
  file: 'scripts/catalog/classic-ids/classic-id-overlay-expected.json',
  script: 'build:classic-ids',
});
