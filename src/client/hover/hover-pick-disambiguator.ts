// Cross-provider pick disambiguator for the hover engine — the tightest
// surface enclosing the cursor wins. See ./README.md.

import type * as THREE from 'three';
import type { OccluderQuery } from '../occlusion/occluder-set';
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

/** Generic tiebreak core — smallest enclosure wins, then deepest inside
 *  it (./README.md Rule 3). `disambiguateHits` wraps it for the engine's
 *  provider-paired hits; the click FSM runs it over the roster's per-kind
 *  picks, so the two cannot disagree. */
export function bestHitBy<T>(
  items: readonly (T | null)[],
  hitOf: (item: T) => HoverHit,
): T | null {
  let best: T | null = null;
  let bestRadius = Infinity;
  let bestDepth = Infinity;
  for (const item of items) {
    if (item === null) continue;
    const h = hitOf(item);
    if (h.enclosureRadiusPx < bestRadius
      || (h.enclosureRadiusPx === bestRadius && h.depthScore < bestDepth)) {
      best = item;
      bestRadius = h.enclosureRadiusPx;
      bestDepth = h.depthScore;
    }
  }
  return best;
}

/** The frame's near solid bodies plus where the camera reads them from —
 *  everything the one occlusion gate needs. */
export type PickVisibility = {
  occluders: OccluderQuery;
  cameraPos: Readonly<THREE.Vector3>;
};

/** Every hit the cursor found, minus the ones a nearer solid body hides,
 *  reduced to the tightest survivor. The ONLY place occlusion is decided;
 *  never add a second gate in a layer (./README.md Rule 3). */
export function bestVisibleHitBy<T>(
  items: readonly (T | null)[],
  hitOf: (item: T) => HoverHit,
  vis: PickVisibility | null,
): T | null {
  const visible = vis === null
    ? items
    : items.filter((it) => it === null || !vis.occluders.hides(hitOf(it).anchorLocal, vis.cameraPos));
  return bestHitBy(visible, hitOf);
}

export function disambiguateHits(
  hits: readonly HoverProviderHit[],
  vis: PickVisibility | null = null,
): HoverProviderHit | null {
  return bestVisibleHitBy(hits, (h) => h.hit, vis);
}
