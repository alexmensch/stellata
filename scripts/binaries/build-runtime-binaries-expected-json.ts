// The count snapshot of build:binaries-runtime. See /scripts/util/sources/README.md#a-snapshot.

import type { StagedCounts } from '../util/counts/count-stages-pure';
import { defineSnapshot } from '../util/sources/snapshot-pure.ts';

export const RUNTIME_BINARIES_COUNTS = defineSnapshot<StagedCounts>({
  file: 'scripts/binaries/build-runtime-binaries-expected.json',
  script: 'build:binaries-runtime',
});
