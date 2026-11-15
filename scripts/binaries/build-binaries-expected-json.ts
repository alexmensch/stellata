// The count snapshot of build:binaries. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../util/counts/count-stages-pure';
import { defineSnapshot } from '../util/sources/snapshot-pure.ts';

export const BUILD_BINARIES_COUNTS = defineSnapshot<StagedCounts>({
  file: 'scripts/binaries/build-binaries-expected.json',
  script: 'build:binaries',
});
