// Stage 4's build-log lines, read off the Stage4Result it returned.

import { formatShare, prefixed } from '../../util/counts/tally-pure';
import { countsListed } from '../build-log-pure';
import { orbitTally, stage4Rates, type Stage4Result } from './attach-orbits';

export function stage4Report(result: Stage4Result): string[] {
  const tally = orbitTally(result);
  return [
    `orbits sourced: ${countsListed(tally)}`,
    `NSS orbit rate: ${formatShare(stage4Rates(prefixed('orbit_', tally)).nss_orbit_rate)} of pairs with elements`,
  ];
}
