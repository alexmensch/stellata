// Stage 3's build-log lines, read off the Stage3Result it returned.

import { formatShare, prefixed } from '../../util/counts/tally-pure';
import { count, countsListed } from '../build-log-pure';
import type { ReferenceCatalogs } from '../load/reference-catalogs';
import { nssTally, resolutionTally, routeTally, stage3Counts, stage3Rates, type Stage3Result } from './attach-astrometry';

export function stage3Report(reference: ReferenceCatalogs, result: Stage3Result): string[] {
  const { synthesized, ...skipped } = nssTally(result);
  const routes = routeTally(result);
  const rates = stage3Rates({ ...stage3Counts(reference, result), ...prefixed('astrometry_', routes) });
  return [
    `synthesized ${count(synthesized)} NSS inner pairs (skipped: ${countsListed(skipped)})`,
    `AT-HYG position fallback: ${count(result.siblingClaimed.length)} matches onto a row another letter already binds`,
    `Resolution: ${countsListed(resolutionTally(result))}`,
    `astrometry routing: ${countsListed(routes)}`,
    `Gaia resolve rate: ${formatShare(rates.gaia_resolve_rate)}; HIP2 fallback rate: ${formatShare(rates.hip2_fallback_rate)}`,
  ];
}
