// `pnpm run validate:distances`: exits 0 on pass, 1 on a missed bar. See README.md.

import { BAILER_JONES } from '../catalog/distance/refinement/bailer-jones-source';
import { readArtifact } from '../util/sources/source';
import {
  LARGE_DIFF_COUNT_MAX, MEDIAN_FRAC_DIFF_MAX, buildReport, formatReport, passesAcceptanceBars, pct,
} from './validate-distances-pure';
import { VAIDMAN_SUPERGIANTS } from './vaidman-tsv';

const report = buildReport(readArtifact(VAIDMAN_SUPERGIANTS), BAILER_JONES.read().distPc);
console.log(formatReport(report));
if (passesAcceptanceBars(report)) {
  console.log('validate-distances: PASS');
} else {
  console.error(
    `validate-distances: FAIL — median ${pct(report.edsd.stats.median)} > ${pct(MEDIAN_FRAC_DIFF_MAX)} `
      + `OR large-diff count ${report.edsd.large.length} > ${LARGE_DIFF_COUNT_MAX}`,
  );
  process.exitCode = 1;
}
