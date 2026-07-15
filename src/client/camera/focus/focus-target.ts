// Per-object FocusTarget contract consumed by warp / focus-lerp /
// arrival code. See src/client/camera/focus/README.md § FocusTarget
// contract.

import * as THREE from 'three';

/** Focusable-object kind tag. New kinds extend this union. */
export type TargetKind = 'star' | 'cloud' | 'lg';

/** A (kind, index) reference to one focusable object. The focus and
 *  distance-vector slots on FocusController each hold one of these —
 *  mutual exclusion between kinds is structural, not enforced by
 *  pairwise clears. */
export interface Target {
  readonly kind: TargetKind;
  readonly idx: number;
}

/** A focusable object — star, cloud, Local Group object, future
 *  planet/probe/nebula/etc. */
export interface FocusTarget {
  /** Identity tag. Used for event-payload dispatch and equality checks
   *  in higher-level code (URL state, focus-vector match-up). New kinds
   *  add a value to this union. The warp / lerp internals do not switch
   *  on `kind`. */
  readonly kind: TargetKind;

  /** Catalog index within this kind. Carries the same value the legacy
   *  `focusedStar` / `focusedCloud` integer fields hold. Event payloads
   *  for `'focus'` / `'cloudFocus'` ship this value. */
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

  /** Fire the deferred focus-event family that `applyFocus` set up.
   *  Typically `'focus'` / `'cloudFocus'` (plus a sibling-clearing null
   *  emit when the previously-focused object was of a different kind),
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
