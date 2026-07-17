// Cross-provider pick disambiguator for the hover engine — prime beats
// fallback, then closer camera distance wins. See ./README.md.

import type { HoverHit, HoverProvider } from './hover-types';

// One provider's hit, paired with the provider that produced it.
// The engine collects these by calling each registered provider's
// `pick()` and keeping the non-null results. Used as both the input
// and output type so callers can route the winner straight back to
// `winner.provider.format(winner.hit.idx)`.
export type HoverProviderHit = {
  provider: HoverProvider;
  hit: HoverHit;
};

/** Generic tiebreak core — prime beats fallback, then closer camera
 *  wins. `disambiguateHits` wraps it for the engine's provider-paired
 *  hits; the click FSM runs it over bare per-layer picks (star vs
 *  planet) so click and hover can't disagree on which object wins. */
export function bestHitBy<T>(
  items: readonly (T | null)[],
  hitOf: (item: T) => HoverHit,
): T | null {
  let primeBest: T | null = null;
  let fbBest: T | null = null;
  for (const item of items) {
    if (item === null) continue;
    const h = hitOf(item);
    if (h.tier === 'prime') {
      if (primeBest === null || h.cameraDistancePc < hitOf(primeBest).cameraDistancePc) {
        primeBest = item;
      }
    } else {
      if (fbBest === null || h.cameraDistancePc < hitOf(fbBest).cameraDistancePc) {
        fbBest = item;
      }
    }
  }
  return primeBest ?? fbBest;
}

export function disambiguateHits(
  hits: readonly HoverProviderHit[],
): HoverProviderHit | null {
  return bestHitBy(hits, (h) => h.hit);
}
