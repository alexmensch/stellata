// Shared types for the hover-label engine — `HoverProvider`,
// `HoverHit`, `HoverPayload`. See ./README.md.

import type * as THREE from 'three';

// One pick result from a single layer's pick path.
//
// `enclosureRadiusPx` is the cross-layer ranking key: the on-screen
// half-extent of the surface the cursor was found inside, floored at the
// engine's pixel threshold so a sub-pixel disc still reports the radius a
// user can actually aim at. Smallest wins — the tightest thing enclosing
// the cursor is the one being pointed at. It carries no notion of which
// kind produced it, which is the point: a new layer joins the ordering
// correctly by reporting its own size, with nothing to add here.
//
// Camera distance is NOT a ranking key and must not become one. Viewed
// from outside, an enclosing surface's near wall is nearer than every
// object it contains, so "closest wins" hands a click on a star to the
// Local Bubble, and a background cloud is unreachable wherever a
// foreground one overlaps it (`./README.md` Rule 3). `cameraDistancePc`
// rides along for card text only.
//
// `depthScore` breaks ties between equally-sized enclosures — how deep
// inside its own surface the cursor sits, scale-invariant, so coincident
// catalogue rows still separate.
//
// `anchorLocal` is the local-frame point the cursor actually found — the
// raycast's hit point for a silhouette surface, the centre for a compact
// one, never a whole object's centroid where the cursor met its edge. It
// is what lets ONE occlusion gate answer for every kind
// (`../occlusion/README.md`): a hit a nearer solid body hides is dropped
// before ranking, wherever it came from. The field is required rather
// than optional precisely so a kind added later cannot quietly opt out
// of being occluded and reappear through a planet.
//
// `hostStarIdx` is an optional sub-layer identity slot used by providers
// whose `idx` alone doesn't pin a unique object — currently the planet
// provider (a planet is identified by `(hostStarIdx, planetIdx)`,
// future-ready for the exoplanet epic multi-host). Layers whose `idx` is
// already a unique catalog row (stars, Local Group, clouds, the lone
// heliopause apex) leave it `undefined`; the engine doesn't read it,
// only the originating provider's `format` does.
export type HoverHit = {
  idx: number;
  cameraDistancePc: number;
  enclosureRadiusPx: number;
  depthScore: number;
  anchorLocal: Readonly<THREE.Vector3>;
  hostStarIdx?: number;
};

// What the engine renders into the tooltip. Same shape star hover has
// today (name + sub-lines); every class formats to this contract.
// Keep lines short (≤ 5 entries).
export type HoverPayload = {
  name: string;
  lines: string[];
};

// One renderable layer's hover surface. The engine walks every
// registered provider on each hover tick, collects non-null hits,
// hands them to the disambiguator, then formats the winner.
//
// `kind` identifies the layer for chart-mode styling and debug. Stays
// a string literal union — adding a new class extends the union here.
export interface HoverProvider<TKind extends HoverKind = HoverKind> {
  readonly kind: TKind;
  pick(clientX: number, clientY: number, pxThreshold: number): HoverHit | null;
  // Format receives the full `HoverHit` so a provider whose layer needs
  // sub-layer identity (e.g. the planet provider reading `hostStarIdx`)
  // can decode the winning pick without re-querying state. Star /
  // Local Group / cloud / heliopause providers ignore everything but
  // `hit.idx`.
  //
  // `null` means "no card warranted" — the engine renders nothing. A
  // provider whose state moved between `pick` and `format` returns null
  // rather than an empty payload; an empty payload would render a blank
  // card at the cursor.
  format(hit: HoverHit): HoverPayload | null;
}

export type HoverKind =
  | 'star'
  | 'planet'
  | 'local-group'
  | 'cloud'
  | 'shell'
  | 'probe';
