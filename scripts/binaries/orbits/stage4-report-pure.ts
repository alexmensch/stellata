// Stage 4's build-log lines, read off the Stage4Result it returned.

import { countsListed, percent } from '../build-log-pure';
import { orbitTally, stage4Counts, stage4Rates, type Stage4Result } from './attach-orbits';

export function stage4Report(result: Stage4Result): string[] {
  return [
    `orbits sourced: ${countsListed(orbitTally(result))}`,
    `NSS orbit rate: ${percent(stage4Rates(stage4Counts(result)).nss_orbit_rate)} of pairs with elements`,
  ];
}
