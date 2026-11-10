// Stage 3's build-log lines, read off the Stage3Result it returned.

import { count, countsListed } from '../build-log-pure';
import { nssTally, resolutionTally, routeTally, type Stage3Result } from './attach-astrometry';

export function stage3Report(result: Stage3Result): string[] {
  const { synthesized, ...skipped } = nssTally(result);
  return [
    `synthesized ${count(synthesized)} NSS inner pairs (skipped: ${countsListed(skipped)})`,
    `AT-HYG position fallback: ${count(result.siblingClaimed.length)} matches onto a row another letter already binds`,
    `Resolution: ${countsListed(resolutionTally(result))}`,
    `astrometry routing: ${countsListed(routeTally(result))}`,
  ];
}
