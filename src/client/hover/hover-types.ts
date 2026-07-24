// Shared types for the hover-label engine — `HoverProvider`,
// `HoverHit`, `HoverPayload`. See ./README.md.

// One pick result from a single layer's pick path. `tier` mirrors the
// star picker's two-tier shape (prime = cursor inside the rendered
// disc / wireframe envelope; fallback = cursor near the centroid).
// `cameraDistancePc` breaks ties across providers — closer to camera
// wins, matching what a human user expects when one object visually
// sits in front of another.
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
  tier: 'prime' | 'fallback';
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
  | 'shell';
