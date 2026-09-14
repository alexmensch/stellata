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
 *  it. `disambiguateHits` wraps it for the engine's provider-paired hits;
 *  the click FSM runs it over the roster's per-kind picks so click and
 *  hover can't disagree on which object wins.
 *
 *  The comparison reads nothing but the two numbers every hit carries, so
 *  a kind added later ranks correctly against every existing one without
 *  touching this file. */
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
 *  reduced to the tightest survivor.
 *
 *  This is the ONLY place occlusion is decided, and every kind's pick
 *  reaches it — which is the point. A gate per layer is how a kind gets
 *  missed: probes were, and Voyager 2 answered the cursor through Sol's
 *  disc while four other kinds were correctly refusing to. A kind added
 *  later is covered here without being asked to do anything but report
 *  its `anchorLocal`. */
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
