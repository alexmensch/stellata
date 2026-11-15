// The distance-outlier snapshot of build:catalog. See /scripts/util/sources/README.md#a-snapshot.

import type { RegressionReport } from './distance-regression-check';
import { defineSnapshot } from '../../../util/sources/snapshot-pure.ts';

export const DISTANCE_OUTLIERS = defineSnapshot<RegressionReport>({
  file: 'scripts/catalog/distance/refinement/build-distance-outliers-expected.json',
  script: 'build:catalog',
});
