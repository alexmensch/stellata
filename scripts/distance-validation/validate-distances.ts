// `pnpm run validate:distances`: exits 0 on pass, 1 on a missed bar. See README.md.

import { BAILER_JONES } from '../catalog/distance/refinement/bailer-jones-source';
import { formatFraction } from '../util/counts/tally-pure';
import { readArtifact } from '../util/sources/source';
import {
  LARGE_DIFF_COUNT_MAX, MEDIAN_FRAC_DIFF_MAX, buildReport, formatReport, passesAcceptanceBars, statFraction,
} from './validate-distances-pure';
import { VAIDMAN_SUPERGIANTS } from './vaidman-tsv';

export function main(): number {
  const report = buildReport(readArtifact(VAIDMAN_SUPERGIANTS), BAILER_JONES.read().distPc);
  console.log(formatReport(report));
  if (passesAcceptanceBars(report)) {
    console.log('validate-distances: PASS');
  } else {
    console.error(
      `validate-distances: FAIL — median ${statFraction(report.edsd.stats, 'median')} > ${formatFraction(MEDIAN_FRAC_DIFF_MAX, 2)} `
        + `OR large-diff count ${report.edsd.large.length} > ${LARGE_DIFF_COUNT_MAX}`,
    );
    return 1;
  }
  return 0;
}
