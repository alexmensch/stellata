// The count snapshot of build:clouds. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../util/counts/count-stages-pure';
import { defineSnapshot } from '../util/sources/snapshot-pure.ts';

export const CLOUDS_COUNTS = defineSnapshot<StagedCounts>({
  file: 'scripts/clouds/build-clouds-expected.json',
  script: 'build:clouds',
});
