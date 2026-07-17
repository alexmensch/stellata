// Per-object FocusTarget contract consumed by warp / focus-lerp /
// arrival code. See src/client/camera/focus/README.md § FocusTarget
// contract.

import * as THREE from 'three';

/** Focusable-object kind tag. New kinds extend this union. A planet
 *  target's idx is the PlanetBodyField flat global instance index;
 *  (host, planet-within-host) resolve through the field's attach
 *  table. */
export type TargetKind = 'star' | 'cloud' | 'lg' | 'planet';

/** A (kind, index) reference to one focusable object. The focus and
 *  distance-vector slots on FocusController each hold one of these —
 *  mutual exclusion between kinds is structural, not enforced by
 *  pairwise clears. */
export interface Target {
  readonly kind: TargetKind;
  readonly idx: number;
}

export function targetsEqual(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.idx === b.idx;
}

/** Hard focus kinds (star / planet) recentre the floating origin onto
 *  the object and drop the orbit floor to a per-body physical solve;
 *  they're also the only valid observe anchors (the camera parks
 *  exactly at the object, which needs the float32-clean local frame a
 *  recentre establishes). Soft kinds (cloud / LG) do neither. */
export function isHardTarget(t: Target | null): boolean {
  return t !== null && (t.kind === 'star' || t.kind === 'planet');
}

/** Per-kind geometry legs the kind-agnostic shell surface dispatches
 *  through (flyTo park math, overlay projection, chevron sizing).
 *  Camera-transition code consumes objects through `FocusTarget`
 *  instead. Star-only affordances are getFocusedStar() guards, never
 *  provider legs — see README.md § FocusableProviders before adding
 *  one. */
export interface FocusableProvider {
  /** Floating-frame position; false when the layer hasn't loaded or
   *  the index is out of range (out untouched). */
  localPositionInto(idx: number, out: THREE.Vector3): boolean;
  /** Camera-to-object distance the focus-park lerp lands at. */
  focusParkDistance(idx: number): number;
  /** Geometric radius (pc) driving the angular-size arrival ease, or
   *  null when the kind has none (ellipsoids) — the curve falls back
   *  to its log-d profile. */
  arrivalRadiusPc(idx: number): number | null;
  /** Rendered silhouette diameter in px at the current camera. */
  renderedSizePx(idx: number): number;
}

/** EXHAUSTIVE over TargetKind — adding a focusable kind without a
 *  provider fails tsc, same contract shape as FocusCardProviders.
 *  Don't weaken it to a partial map. */
export type FocusableProviders = { readonly [K in TargetKind]: FocusableProvider };

/** A focusable object — star, cloud, Local Group object, future
 *  planet/probe/nebula/etc. */
export interface FocusTarget {
  /** Identity tag. Used for event-payload dispatch and equality checks
   *  in higher-level code (URL state, focus-vector match-up). New kinds
   *  add a value to this union. The warp / lerp internals do not switch
   *  on `kind`. */
  readonly kind: TargetKind;

  /** Catalog index within this kind — the same value the 'focus' /
   *  'vector' event payloads ship inside their Target. */
  readonly idx: number;

  /** Absolute-space anchor (catalog-frame parsecs). This is the value
   *  passed to `recenterOrigin` when the floating origin tracks this
   *  object. Writes into `out` and returns `true` on success; returns
   *  `false` (and leaves `out` untouched) when the underlying data is
   *  unavailable (e.g., cloud layer not loaded yet). */
  anchorInto(out: THREE.Vector3): boolean;

  /** Current floating-origin local-frame position. Used by per-frame
   *  `camera.lookAt(...)` during warp Fly and by overlay projection
   *  paths. Same contract as `anchorInto`'s return value: false on
   *  unavailable-source. */
  localPositionInto(out: THREE.Vector3): boolean;

  /** Camera-to-anchor distance at the parked pose. For stars: the
   *  per-star `parkDistForStar` (90 %-fill floor or GLOBAL_MIN_DIST).
   *  For clouds: `cloudViewingDistancePc` (ellipsoid-aware). The warp
   *  computes `pStart` / `pEnd` as `anchor − travelDir · parkRadius()`
   *  for source and destination respectively. */
  parkRadius(): number;

  /** Per-kind focus-state mutation. Sets the relevant
   *  `focusedStar` / `focusedCloud` field, updates derived state
   *  (per-focus `minDistance`, planet-system attach, etc.), and clears
   *  whichever sibling focus field was previously set — all WITHOUT
   *  firing any events on the bus. Events are deferred to
   *  `emitFocusEvents` so the UI can be settled in lock-step with the
   *  camera landing (see `finishWarp`). */
  applyFocus(): void;

  /** Fire the deferred 'focus' emit (kind-tagged Target payload)
   *  followed by `'state'` so the URL writer serialises the new pose.
   *  Called from `finishWarp` after the camera has fully landed. */
  emitFocusEvents(): void;

  /** Physical radius of the focal object in parsecs, or `null` when
   *  the kind has no well-defined geometric radius (clouds: ellipsoid
   *  axes don't reduce to a single radius). Consumed by arrival curves
   *  that need angular size on screen — e.g. the `'hybrid'` curve in
   *  `arrival-curves.ts` uses `θ = R / d` to drive the close-approach
   *  smoothstep. Kinds that return `null` cause angular-size-based
   *  curves to silently fall back to a log-d profile rather than
   *  fail. */
  physicalRadius(): number | null;

  /** Camera-to-anchor distance at which the chart-mode rendered disc
   *  reaches its `uChartDiscMaxPx` plateau, given the current
   *  `uChartMagBright` setting (the magnitude that maps to max disc
   *  size). Returns `null` when chart-mode plateau doesn't apply —
   *  e.g. clouds, whose chart-mode treatment is an isobar contour
   *  rather than a magnitude-driven disc.
   *
   *  Used by `updateWarp` to pivot Fly → phase 3 early when chart mode
   *  is active and the destination's disc would stop growing
   *  perceptibly under the cubic-Hermite log-d profile (the camera
   *  spends much more time in close-approach than under the legacy
   *  piecewise profile, and a flatlined chart disc leaves the user
   *  with no perceptual progress signal). Phase 3's parallax slerp
   *  then carries the progress cue across the plateau zone.
   *
   *  Derivation: chart disc plateaus when `appMag ≤ magBright`. With
   *  `appMag = absMag + 5·log10(d) − 5` (pc convention), solving for
   *  `d` gives `d_plateau = 10^((magBright − absMag + 5) / 5)` pc. */
  chartPlateauDistance(magBright: number): number | null;
}
