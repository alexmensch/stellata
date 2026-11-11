// Stage 3's build-log lines, read off the Stage3Result it returned.

import { count, countsListed, percent } from '../build-log-pure';
import type { ReferenceCatalogs } from '../load/reference-catalogs';
import type { Stage2Result } from '../resolve/resolve-pairs';
import { nssTally, resolutionTally, routeTally, stage3Counts, stage3Rates, type Stage3Result } from './attach-astrometry';

export function stage3Report(reference: ReferenceCatalogs, resolved: Stage2Result, result: Stage3Result): string[] {
  const { synthesized, ...skipped } = nssTally(result);
  const rates = stage3Rates(stage3Counts(reference, resolved, result));
  return [
    `synthesized ${count(synthesized)} NSS inner pairs (skipped: ${countsListed(skipped)})`,
    `AT-HYG position fallback: ${count(result.siblingClaimed.length)} matches onto a row another letter already binds`,
    `Resolution: ${countsListed(resolutionTally(result))}`,
    `astrometry routing: ${countsListed(routeTally(result))}`,
    `Gaia resolve rate: ${percent(rates.gaia_resolve_rate)}; HIP2 fallback rate: ${percent(rates.hip2_fallback_rate)}`,
  ];
}
