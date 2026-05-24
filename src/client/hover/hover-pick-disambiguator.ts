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

export function disambiguateHits(
  hits: readonly HoverProviderHit[],
): HoverProviderHit | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];

  let primeBest: HoverProviderHit | null = null;
  let fbBest: HoverProviderHit | null = null;
  for (const h of hits) {
    if (h.hit.tier === 'prime') {
      if (
        primeBest === null ||
        h.hit.cameraDistancePc < primeBest.hit.cameraDistancePc
      ) {
        primeBest = h;
      }
    } else {
      if (
        fbBest === null ||
        h.hit.cameraDistancePc < fbBest.hit.cameraDistancePc
      ) {
        fbBest = h;
      }
    }
  }
  return primeBest ?? fbBest;
}
