// Stage 3's build-log lines, read off the Stage3Result it returned.

import { count } from '../build-log-pure';
import { nssTally, resolutionTally, routeTally, type Stage3Result } from './attach-astrometry';

const listed = (tally: Record<string, number>): string => Object.entries(tally).map(([k, v]) => `${k}=${count(v)}`).join(', ');

export function stage3Report(result: Stage3Result): string[] {
  const { synthesized, ...skipped } = nssTally(result);
  return [
    `synthesized ${count(synthesized)} NSS inner pairs (skipped: ${listed(skipped)})`,
    `AT-HYG position fallback: ${count(result.siblingClaimed.length)} matches onto a row another letter already binds`,
    `Resolution: ${listed(resolutionTally(result))}`,
    `astrometry routing: ${listed(routeTally(result))}`,
  ];
}
