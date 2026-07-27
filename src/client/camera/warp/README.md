# Warp animation

The animated camera flight between a source anchor (A) and the
distance-vector destination (B). 3-phase state machine, phase math,
scale-bar behaviour, and the navigate↔observe interactions on
launch and arrival.

The warp consumes focusable objects through the `FocusTarget` contract
(see `../focus/README.md`); the warp animation itself is kind-agnostic.

## Files

- `warp-controller.ts` (+ test) — the 3-phase FSM (reorient → fly →
  post-arrival). Owns `WarpState`, `startWarp` / `finishWarp` /
  `updateWarp` / `tryMidFlyRecentre` / `finishObserveAnchorSwap`, plus the
  warp-only scratch state. The integration shell composes the
  controller alongside Picker / AimController and delegates the
  animate-loop tick when `warp.isActive()` returns true. Cross-
  controller coupling (focus state, FocusTarget factories,
  floating-origin recentre, vector-slot clear) lives behind the
  `FocusOps` interface implemented by `FocusController` (in
  `../focus/`).
- `warp-pure.ts` (+ test) — pure phase math (slerp, ease, the
  recentre predicate). Floating-origin migration of in-flight
  `WarpState` waypoints lives here as `shiftWarpWaypoints`; the
  sibling `shiftArrivalWaypoints` lives in `../arrival/camera-motion.ts`.
- `warp-tuning.ts` — tuning section in the debug panel. Sliders write
  into `../camera-config.ts`; the panel is the only writer and no
  shipped path imports it. See `../README.md` § Shipping config vs
  debug panel.
- `warp-telemetry.ts` — last-warp summary slot, written by
  `finishWarp`, read by the tuning readout. Debug observability only;
  nothing in the warp path reads it back.
- `warp-button.ts` — W-key warp trigger, the in-flight "Skip" pill,
  and the `body.warping` CSS class.

## Warp animation

Trigger: press `W` while a distance vector is drawn. (Clicking the
distance label aims the camera at the destination — the Sol/GC-label
affordance — it does NOT warp.) Skip: the muted ghost pill at
top-centre (shown only while warping), or `Esc` / `Space`.
Double-click-to-travel routes through `focusStar(idx)` for
consistency with search-select (parks at `parkDistForStar(idx)` —
same auto-park every landing uses; lerps over `FOCUS_LERP_MS` or
stays put when already inside park; see `../focus/README.md`
§ Focus-park lerp).

Two- or three-phase animation in `WarpController.updateWarp` (called
per frame via `WarpController.tick(nowMs)`), depending on whether the
warp re-enters OBSERVE on arrival.

### 1. Reorient (`WARP_REORIENT_MS` = 1800)

Camera position spherically slerps around A from wherever the user
was to `A + dirBack × sourceOffset` (on the travel line, offset
behind A from B's perspective). Simultaneously the orbit distance
eases linearly from `mag0` down to `sourceOffset`. End state: A is
centred and B is straight ahead, beyond A. Quaternion slerp is used
for the angular interp (robust against antipodal starting positions).
`sourceOffset` is the source's own auto-park distance (see
`../controls/README.md` § Camera near plane vs controls minDistance),
separate from `endOffset` (the destination's). Decoupling these
handles asymmetric warps cleanly: a Betelgeuse → Sol flight starts
well outside Betelgeuse's giant disc and arrives at Sol's small park
radius, with neither endpoint inside the other star.

Camera orientation during the reorient depends on launch mode:

- **Navigate launch:** `camera.lookAt(A)` is called every frame. With
  `mag0 > 0` this keeps A perfectly centred as the camera swings
  around it. Roll comes along for free: `lookAt` reads `camera.up`, which
  the reference-up correction has already levelled this frame
  (`../controls/README.md` § Reference up axis), so a swing that crosses
  the sky stays galactic-level throughout instead of inheriting whatever
  roll the pre-warp orbit had drifted to.
- **Observe launch** (`returnToObserve`, `mag0 ≈ 0`): the
  lookAt-per-frame approach degenerates — the camera starts on top
  of A, so `lookAt(A)` snaps to "facing forward" the instant the
  position moves off A. Instead we slerp the camera quaternion from
  `startQuaternion` (the user's observe view direction) to a
  `reorientEndQuaternion` captured at warp start (= the orientation
  `lookAt(A)` would produce from `pStart`). This animates the user's
  view smoothly turning from wherever they were looking to "facing
  the destination" before the fly phase begins.

### 2. Fly (log-scaled duration, `WARP_T_MIN_MS` to `WARP_T_MAX_MS`)

Camera position rides the line from `pStart` (= A + dirBack ×
sourceOffset) to `pEnd` (= B − forward × endOffset), delegated to
`../arrival/camera-motion.ts:tickArrival` so the Fly phase shares the
shipped arrival profile with focus-park and unfocus. The profile is
the **hybrid two-regime curve** — linear-d piecewise-quad outer
(rocket-impulse, parallax-driven) → quintic smootherstep on
angular-size inner (smooth perceptual landing on disc growth), with
a single tunable seam-distance multiplier. See `../arrival/README.md`
§ Profile for the geometry and the panel-knob wiring.
`camera.lookAt(B)` throughout.

**Mid-Fly floating-origin recentre.** The moment the camera passes
the trajectory midpoint (`|camera − B|² < ¼·|B − A|²` — the
"source star is behind the camera" cue), `updateWarp` calls
`tryMidFlyRecentre`, which shifts the floating origin onto the
destination's absolute anchor and migrates the in-flight `WarpState`
waypoints + `ArrivalState` cached vectors into the new frame via
`shiftWarpWaypoints` + `shiftArrivalWaypoints`. After the shift,
`dest.localPositionInto` returns ≈(0,0,0), so the per-frame
`lookAt(B)` becomes `lookAt(local origin)` — geometrically
equivalent, numerically clean.

Why this exists: any log-d Fly profile parks the camera inside
`|B − camera| < ULP(|B|)` for some non-trivial window of long-range
arrivals (e.g. Betelgeuse → Sol). In that zone `B − camera.position`
loses all Float32 precision and the `lookAt` quaternion jitters
across representable values, so the destination renders off-screen
for several frames before `finishWarp` recentres and snaps it to NDC
origin. Recentring mid-Fly eliminates the chaos zone entirely.

Kind-agnostic via the `FocusTarget` contract — works for any
focusable kind that implements `anchorInto` and `applyFocus`.
`dest.applyFocus()` mutates focus state in place; the deferred event
family is fired from `finishWarp` via `dest.emitFocusEvents()` so the
search-row label and friends settle in lock-step with the camera
landing rather than ~half a warp duration early.

**Chart-mode plateau-trigger.** Chart mode renders stars as
magnitude-driven discs (`pxSize = mix(maxPx, minPx, chartT)` with
`chartT = clamp((appMag − magBright)/(maxAppMag − magBright), 0, 1)`).
Once the camera is close enough that `appMag ≤ uChartMagBright`,
`chartT` floors to 0 and the disc plateaus at `uChartDiscMaxPx`.
Under both the hybrid inner regime and the cubic-Hermite fallback,
the camera spends much longer in the close-approach window than
under the legacy piecewise profile — so the user can sit for
hundreds of milliseconds inside the plateau zone watching a disc
that doesn't grow, with no perceptual progress signal. Pivot to
phase 3 early instead: when chart mode is active (observe-only) at
warp start, cache the plateau distance via
`dest.chartPlateauDistance(uChartMagBright)` (`chart-disc-pure.ts`
solves the distance-modulus identity for the threshold magnitude:
`d = 10^((magBright − absMag + 5)/5)` pc — Sol's default plateau
sits at ~0.43 pc, Betelgeuse's at ~58.9 pc). During Fly, once the
camera is inside that radius AND mid-Fly recentre has fired, pin
`state.pEnd` to the current camera position and shrink
`state.durationMs` to the elapsed Fly time so the next frame falls
into phase 3 with `flyEndQuaternion` captured from the live
`lookAt(dest)` orientation. Phase 3's parallax slerp then carries
the perceptual progress signal across the plateau zone (a flatlined
disc + a rotating camera reads as motion). Gated on
`recenteredToDest` so the dest-local position check is well-conditioned
(target at (0,0,0), no ULP residual) and so the transition can't fire
before the floating-origin shift cleans up the projection chain.
Clouds return `null` from `chartPlateauDistance` — chart mode
renders them as isobar contours rather than discs, no plateau to
detect.

Two settled constants shape the cue, both in `warp-controller.ts`:
`CHART_PLATEAU_MARGIN` (0.7) scales the trigger radius — below 1 the
pivot fires deeper into the plateau; and `CHART_PHASE3_ALPHA` (0.2)
stretches phase 3 by `1 + α·log10(d_trigger / endOffset)`, so a long
plateau-to-park haul gets proportionally more parallax time instead of
sweeping the whole distance in a flat 1.8 s.

### 3. Post-arrival reorient (`returnToObserve` only, `OBSERVE_TRANSITION_MS` = 1800)

Quaternion slerps from the fly-end "looking at B" orientation back to
the `startQuaternion` snapshot taken at warp start. The user sees the
same celestial direction they were facing when they picked the
destination, now from the new vantage — foreground stars shift via
parallax, distant Milky Way stays roughly fixed.

Camera position **also lerps from `pEnd` to `B`** across this phase,
so the parallax view ends with the camera exactly at the destination
star. Without this, `finishObserveAnchorSwap` would absorb an
`endOffset`-sized hidden teleport at `finishWarp` (its `set(0,0,0)`
snap), leaving the user with the impression that the slerp happened
from the wrong vantage. The destination disc stays visible across
the entire post-arrival window — `finishObserveAnchorSwap` pins
`uHideFocusIdx` to the destination only at `finishWarp`, so the user
sees the star they're arriving at right up until the camera parks
inside it. Hiding it earlier would feel like the star pops out
before the camera arrives.

Skipped on navigate-mode arrivals because
`TrackballControls.update()` calls `camera.lookAt(target=B)` every
frame and would overwrite the slerped quaternion one frame after
`finishWarp`, leaving the user with a hard snap-back. Observe
arrivals preserve the slerp because controls are disabled and
`observeUpdateTarget` reads `controls.target` from the camera
quaternion, not the other way around.

The floating origin is recentred onto B at the start of phase 3 (not
at `finishWarp`). Without this, both the camera and B sit at the
same kpc-scale magnitude in the source-local frame for the 1.2 s
slerp window, and `matrixWorldInverse * B` loses float32 precision —
visible as the destination star jittering as the quaternion rotates.
After the recentre B is at local `(0,0,0)` and the camera lerps in
from a small offset; the projection chain stays clean. `uHideFocusIdx`
still points at the source for the rest of phase 3 so the destination
remains visible throughout the parallax slerp; `finishObserveAnchorSwap` at
`finishWarp` re-points it to the destination on landing. Mirrors the
navigate-mode path (`setFocus(destIdx)` recentre at `finishWarp`),
pulled forward by `postArrivalMs`.

## Scale-bar smoothness

`controls.target` is pointed at **B** from the moment the warp begins
(not just at arrival). Camera orientation is controlled independently
via `camera.lookAt`, so the reorient phase can still keep A centred
visually while the horizontal scale bar (which reads scene-scale at
the camera-target depth) already reflects distance-to-destination —
this avoids a jarring scale-bar snap when the target would otherwise
switch from A to B at arrival.

## Side effects during warp

- `controls.enabled = false` (no orbit).
- Pointer-up click handling is short-circuited.
- The URL writer skips frame-hash updates (camera is changing every
  frame and we don't want to serialise intermediate poses).
- `body.warping` toggles a CSS class that hides the entire SVG
  overlay (distance vector, figure, focus ring) since their per-frame
  reprojection looks chaotic under fast travel.

## OBSERVE mode and the warp state machine

Warp launched from OBSERVE leaves `cameraMode` as `'observe'` for the
duration (the animate loop branches on `warpState` first, so the
value is purely cosmetic). Two gotchas worth noting up front:

1. **`cameraMode` stays `'observe'` throughout an observe→observe
   warp.** `startWarp` from observe disables `observeControls` and
   sets a per-warp `returnToObserve` flag, but does not flip
   `cameraMode` or emit `'cameraMode'`. Every listener bound to
   `'cameraMode'` (mode toggle, search-row label, etc.) stays
   settled. Without this, observe→observe arrival visibly flickers
   through navigate mid-warp.
2. **`finishWarp` re-anchors via `finishObserveAnchorSwap`**, not
   `setFocus`, when `returnToObserve` is true. `setFocus` would see
   `cameraMode === 'observe'` and run its observe-cleanup branch
   (`uHideFocusIdx = -1`, emit `'cameraMode'`), recreating the
   flicker. `finishObserveAnchorSwap` recentres the floating origin,
   updates `focusedStar`, repoints `uHideFocusIdx` to the new
   anchor, and snaps the camera to `(0, 0, 0)` local without
   touching `cameraMode`.

Source-star hide (`uHideFocusIdx = focusedStar`) stays pinned across
the entire warp duration when launched from observe — the reorient
phase starts with the camera *at* the source star, and unhiding it
would briefly render the disc from inside.

**Collocated endpoints have no special case.** α Cen A/B (one catalog
baseline) and ρ=0 inner pairs on their parent (Castor Bb→B) fly the
normal warp. Their `distPc` sits below `WARP_DEGENERATE_DIST_PC`, where
`AB/distPc` is float32 noise, so `startWarp` takes the travel direction
from `camera.getWorldDirection` instead; the reorient is minimal and the
near-zero flight lands via `finishWarp` → `finishObserveAnchorSwap` (observe)
or `setFocus` (navigate). Mid-Fly recentre never fires (the camera stays
farther from the destination than ¼·|AB| the whole flight), exactly as
for any two very-close stars, so the arrival is identical to the proven
close-pair path. Do **not** re-add a degenerate `setFocus`/`finishObserveAnchorSwap`
shortcut: changing focus outside `finishWarp` leaves `controls.target`
stale and jolts the focal-frame ride.

## Public surface

`warpTo(target)` (kind-agnostic — the dest FocusTarget comes from
`FocusOps.makeFocusTarget`), `skip()`, `tick(nowMs)`, `isActive()`,
`isRecenteredToDest()`, `getWarpInfo()`, `getWarpPhase(nowMs?)`,
`dispose()`.

Bus events emitted from the controller:
- `'warp'` (boolean) — true at startWarp, false at finishWarp.
- `'state'` — at startWarp, at finishWarp (via finishObserveAnchorSwap on
  observe→observe arrivals, via `setFocus` on navigate star arrivals,
  or via the dest FocusTarget's `emitFocusEvents` on soft-kind
  arrivals).
- `'focus'` (Target | null) — only from `finishObserveAnchorSwap`.
