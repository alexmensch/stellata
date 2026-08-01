// Per-kind focusable contracts: kind traits, the FocusableProvider
// registry, and the FocusTarget camera-transition view built from it.
// See src/client/camera/focus/README.md § FocusableProviders.

import * as THREE from 'three';

/** Focusable-object kind tag. New kinds extend this union. A planet
 *  target's idx is the PlanetBodyField flat global instance index;
 *  (host, planet-within-host) resolve through the field's attach
 *  table. A shell target's idx is the `SHELL_KEYS` index
 *  (`fresnel-shell/shell-registry.ts`). A probe target's idx is the
 *  ProbeField roster index (`solar-system/probes/probe-field.ts`). */
export type TargetKind = 'star' | 'cloud' | 'lg' | 'planet' | 'shell' | 'probe';

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

/** Per-kind interaction traits.
 *  `hard`: focus recentres the floating origin onto the object and drops
 *  the orbit floor to a per-object physical solve; hard kinds are also
 *  the only valid observe anchors (the camera parks exactly at the
 *  object, which needs the float32-clean local frame a recentre
 *  establishes). Soft kinds do neither.
 *  `moving`: the object moves in the local frame as `t` advances, so the
 *  moving-focal ride translates the camera with it (a star's orbital
 *  perturbation rides its own focal-frame path instead). */
export interface KindTraits {
  readonly hard: boolean;
  readonly moving: boolean;
}

/** EXHAUSTIVE over TargetKind — adding a kind without declaring its
 *  traits fails tsc. Don't weaken it to a partial map. */
export const KIND_TRAITS: { readonly [K in TargetKind]: KindTraits } = {
  star: { hard: true, moving: false },
  cloud: { hard: false, moving: false },
  lg: { hard: false, moving: false },
  planet: { hard: true, moving: true },
  shell: { hard: false, moving: false },
  probe: { hard: true, moving: true },
};

/** Hard-kind predicate over the declared traits — never spell the
 *  membership out at a call site. */
export function isHardTarget(t: Target | null): boolean {
  return t !== null && KIND_TRAITS[t.kind].hard;
}

/** Per-kind geometry + focus-state legs. One provider per kind, built
 *  by the integration shell; the shell surfaces dispatch through it
 *  (flyTo park math, overlay projection, chevron sizing) and
 *  FocusController derives every focus mutation and `FocusTarget` from
 *  it, so a new kind implements this record and nothing else.
 *  Star-only affordances are getFocusedStar() guards, never provider
 *  legs — see README.md § FocusableProviders before adding one. */
export interface FocusableProvider {
  /** Absolute-space anchor (catalog-frame parsecs) — the
   *  `recenterOrigin` input when a hard kind is focused and when the
   *  warp's mid-Fly recentre pivots onto the object. False when the
   *  layer hasn't loaded or the index is out of range (out untouched). */
  anchorInto(idx: number, out: THREE.Vector3): boolean;
  /** Floating-frame position; same false-on-unavailable contract as
   *  `anchorInto`. */
  localPositionInto(idx: number, out: THREE.Vector3): boolean;
  /** Camera-to-object distance every park lands at: the focus-park lerp
   *  destination, the unfocus zoom-out anchor, and the warp's
   *  source / dest offsets. */
  focusParkDistance(idx: number): number;
  /** Manual-zoom floor applied while this object is focused. Hard
   *  kinds: the per-object physical solve. Soft kinds: the global
   *  floor, unless the object's own park distance is tighter — an
   *  AU-scale shell parks inside the global floor and would otherwise
   *  be clamped straight back out by `controls.update()`. */
  orbitFloor(idx: number): number;
  /** Geometric radius (pc) driving the angular-size arrival ease, or
   *  null when the kind has none (ellipsoids, fixed-pixel markers) —
   *  the curve falls back to its log-d profile. */
  arrivalRadiusPc(idx: number): number | null;
  /** Rendered silhouette diameter in px at the current camera. */
  renderedSizePx(idx: number): number;
  /** Camera-to-anchor distance where the chart-mode disc plateaus at
   *  `uChartDiscMaxPx` given the current `uChartMagBright`; null when
   *  the kind has no magnitude-driven chart disc. Feeds the warp's
   *  early Fly → phase-3 pivot (../warp/README.md § Chart-mode
   *  plateau-trigger). */
  chartPlateauDistance(idx: number, magBright: number): number | null;
  /** Catalog index of the star whose planet system attaches while this
   *  object is focused (a star: itself; a planet: its host; a probe:
   *  Sol), or null to detach (soft kinds). */
  planetSystemHost(idx: number): number | null;
}

/** EXHAUSTIVE over TargetKind — adding a focusable kind without a
 *  provider fails tsc, same contract shape as FocusCardProviders.
 *  Don't weaken it to a partial map. */
export type FocusableProviders = { readonly [K in TargetKind]: FocusableProvider };

/** One focusable object as camera-transition code (warp, focus-park,
 *  mid-Fly recentre) consumes it: the provider legs bound to a single
 *  (kind, idx), plus the deferred focus-mutation pair. Instances are
 *  built generically by `FocusController.makeFocusTarget` from the
 *  `FocusableProviders` record — there are no per-kind factories. */
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

  /** Camera-to-anchor distance at the parked pose — the provider's
   *  `focusParkDistance`. The warp computes `pStart` / `pEnd` as
   *  `anchor − travelDir · parkRadius()` for source and destination
   *  respectively. */
  parkRadius(): number;

  /** Focus-state mutation: sets the focus Target slot (displacing any
   *  other kind structurally), applies the kind's `orbitFloor`, and
   *  attaches (hard kinds) or detaches (soft kinds) the planet system —
   *  all WITHOUT firing any events on the bus. Events are deferred to
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
