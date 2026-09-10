// Cross-provider pick disambiguator for the hover engine — tier first,
// then closer camera distance wins. See ./README.md.

import type { HoverHit, HoverProvider, HoverTier } from './hover-types';

// One provider's hit, paired with the provider that produced it.
// The engine collects these by calling each registered provider's
// `pick()` and keeping the non-null results. Used as both the input
// and output type so callers can route the winner straight back to
// `winner.provider.format(winner.hit.idx)`.
export type HoverProviderHit = {
  provider: HoverProvider;
  hit: HoverHit;
};

/** Rank of each tier — lower wins outright, camera distance decides only
 *  within one. Camera distance cannot be the cross-tier key: viewed from
 *  outside, a boundary shell's near wall is nearer than every star it
 *  encloses, so "closest wins" hands a click on a star to the wall
 *  (`./README.md` Rule 3). */
const TIER_RANK: Record<HoverTier, number> = { prime: 0, fallback: 1, extended: 2 };

/** Generic tiebreak core — better tier wins, then closer camera.
 *  `disambiguateHits` wraps it for the engine's provider-paired hits; the
 *  click FSM runs it over bare per-layer picks (star vs planet vs shell)
 *  so click and hover can't disagree on which object wins. */
export function bestHitBy<T>(
  items: readonly (T | null)[],
  hitOf: (item: T) => HoverHit,
): T | null {
  let best: T | null = null;
  let bestRank = Infinity;
  let bestDist = Infinity;
  for (const item of items) {
    if (item === null) continue;
    const h = hitOf(item);
    const rank = TIER_RANK[h.tier];
    if (rank < bestRank || (rank === bestRank && h.cameraDistancePc < bestDist)) {
      best = item;
      bestRank = rank;
      bestDist = h.cameraDistancePc;
    }
  }
  return best;
}

export function disambiguateHits(
  hits: readonly HoverProviderHit[],
): HoverProviderHit | null {
  return bestHitBy(hits, (h) => h.hit);
}
