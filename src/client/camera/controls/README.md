# Camera controls

Camera setup that's mode-agnostic: near-plane vs minDistance geometry,
TrackballControls tuning, and the two-finger roll gesture that works
in both navigate and observe modes.

## Files

- `controls.ts` — settings-panel bindings (distance / magnitude / size
  sliders, spectral chips, overlay toggles) + the slider↔distance log
  mapping (`sliderToDist` / `distToSlider`).
- `input-controller.ts` (+ test) — canvas pointer input: the click FSM
  (single/double dispatch in both modes, the kind-generic click ladder,
  cloud click semantics), two-finger / Safari-gesture roll, and the
  shift-pan binding lifecycle (see § Input controller).
- `shift-pan.ts` — orbit-first camera translation: pan only while a
  Shift key is held (see § Shift-drag panning).
- `mode-toggle.ts` — navigate / observe pill in the topbar.
- `picker.ts` — pure target resolver; click + hover pick paths for
  stars / clouds / planets / Local Group / heliopause. Both star pick
  surfaces route the winner through `resolveCollapsedLead`: a member of
  a composite-suppressed cluster resolves to the cluster's primary, so
  the hover card, POI pin, vector, and focus all act on the object the
  user sees as "the point" (never an arbitrary closest-to-camera
  member). Identity for unsuppressed stars — a focused member's
  relations bypass the LOD gates, so focused-star click semantics are
  untouched.
- `aim-controller.ts` — mode-aware aim slerps (navigate orbit-pivot
  + observe quaternion-in-place), shared `aimDurationMs` ramp.
- `up-align-pure.ts` — `alignCameraUpToQuaternion` helper.
  `camera-up-align.test.ts` is the algebra fixture.
- `star-geometry.ts` — pure star angular-geometry formulae
  (θ = 2·atan(R/d), `parkDistForStar` derivations).
- `star-physics.ts` — per-star camera/screen geometry: `fovMinorRad`,
  `peakAmplitudeFactor`, `minOrbitDistForStar`, `parkDistForStar`,
  `renderedSizePx`, `renderedDiscPxAtPeak`, `getChartDiscParams` +
  canonical `ZOOM_FLOOR_FRACTION`, `VAR_TROUGH_FLOOR_FRACTION`. The
  planet siblings `minOrbitDistForPlanet` / `parkDistForPlanet`
  (+ `PLANET_PARK_FILL_FRACTION`) live here too — same angular
  solves, keyed on the body radius directly.

### star-geometry vs star-physics vs stellata.ts

- `star-geometry.ts` — pure formulae (no catalog, no uniforms).
- `star-physics.ts` — catalog-indexed wrappers around those formulae.
- `stellata.ts` — wires per-frame uniforms and dispatches.

## Input controller

`InputController` owns every canvas pointer listener: pointerdown /
pointerup / pointercancel (the click FSM), touch + WebKit gesture
events (two-finger roll), and the shift-pan key binding. Clicks in
both modes are held for `DBL_CLICK_MS` (280 ms) by a shared
`PendingClickDispatcher` (`../../util/pending-click.ts`) so single and
double clicks disambiguate; the deferred handlers re-check the
warp / aim / transition guards at fire time. The full per-mode click
decision table lives in `src/client/README.md` § Click-state machine;
the ladder's pure decision function is
`../../poi/click-ladder-pure.ts`.

The controller sees the rest of the app only through its deps
closures (busy gates, Target-keyed focus/vector reads, flyTo /
setOrbitTarget / unfocus / togglePoi / aimAt) — it owns
dispatch order and gesture math, never focus or camera-transition
state. Roll math
uses controller-owned scratch `Vector3`/`Quaternion` instances; the
per-gesture-event path allocates nothing.

## Camera near plane vs controls minDistance

`camera.near = 1e-12`, `controls.minDistance` (when no star is focused)
= `GLOBAL_MIN_DIST_PC = 5e-3` pc. The unfocused floor sits well above
the float32-cancellation threshold so an unfocused orbit can't drift
into the regime where projection precision breaks down — to get any
closer than that, the user must focus a star, which then engages the
per-star `minOrbitDistForStar` floor (sub-pc for Sol-class) plus the
`uPinFocusToCenter` shader pin which sidesteps the float32
cancellation entirely. The near plane must stay
**strictly less** than the closest orbit distance, otherwise a centered
star lands on the clip plane at max zoom and gets culled. The log depth
buffer (`logarithmicDepthBuffer: true` on the WebGL renderer) gives this
configuration uniform precision in `log(z)`, so the
multi-decade range from sub-AU close approach to 100 kpc background
renders without z-fighting.

When a star is focused, two distinct distances are in play —
deliberately decoupled so manual zoom can push past the auto-park
distance. Both come from the **true angular geometry** of the star's
disc through the camera lens — `θ = 2·atan(R / d)`:

1. **Manual-zoom floor** — `controls.minDistance =
   minOrbitDistForStar(idx)`. Solves for `d` such that the disc fills
   `ZOOM_FLOOR_FRACTION` (= 0.9) of the viewport's minor axis:
   ```
   d_min = R / tan(ZOOM_FLOOR_FRACTION × fov_minor / 2)
   ```
   `fov_minor = min(fov_x, fov_y)` so the 90% target reads consistently
   across portrait + landscape viewports. The rule is uniform across
   the catalog — binary primaries get the same close-approach floor as
   single stars, so the user can inspect either component of α Cen,
   Sirius, or any multiple system without the controls bouncing.
   `d_min` scales linearly with the star's physical radius — inspecting
   a Sol-class star vs Betelgeuse vs Sirius B looks the same on screen.

2. **Auto-park target** — `parkDistForStar(idx)`: where the camera
   automatically lands. Used by:

   - `focusStar(idx)`'s default park distance (search-select,
     click-vector-tip, default-load Sol focus). Since r9q.2, focus is
     a lerp-or-noop: the camera glides over `FOCUS_LERP_MS` when
     currently outside park, and stays put when already inside.
   - Observe-exit landing position (camera pulls back to
     `parkDistForStar` along its current view direction when leaving
     observe).
   - Warp source departure (`pStart = A + dirBack × sourceOffset`,
     where `sourceOffset = parkDistForStar(source)` for star sources or
     `cloudViewingDistancePc(source)` for cloud sources — decoupled
     from `endOffset` so a giant source like Betelgeuse warping to
     Sol doesn't place `pStart` inside the source's rendered disc).
   - Warp arrival (`pEnd = B − forward × endOffset`, with
     `endOffset = parkDistForStar(destIdx)`).

   Composes the generic `parkDistance(...)` primitive from
   `focus-transition.ts` with star-specific inputs:
   ```
   parkDistForStar = max(AU_PC + Reff, dMinFloor)
     Reff       = R_pc · peakAmplitudeFactor       (handles variables)
     dMinFloor  = distAtFillFraction(Reff, fov_minor, ZOOM_FLOOR_FRACTION=0.9)
   ```
   Sol parks at ~1.005 AU (just outside Earth's orbit); a supergiant
   parks at the 90 %-fill clamp.

   `minOrbitDistForStar` (the manual-zoom floor — same fov-fraction
   solve at 0.9) and `parkDistForStar` re-evaluate on focus change,
   FOV change (via `setCameraFov`), and viewport resize (since aspect
   changes shift `fov_minor`).

## Focus-park lerp (r9q.2)

Click-focus on a star (or `flyTo` for the soft kinds) no longer
teleports. The lerp lives in `../focus/focus-transition.ts` as the
generic `parkDistance(...)` + `newFocusLerpFrom(...)` +
`tickFocusLerp(...)` trio — stars consume it now; the soft kinds
compose the same primitives; future focusable types (nebulae, etc.)
plug in the same way.

Branch in `focusStar` / the soft-kind leg of `flyTo`:

- **`eyeDist <= parkDist` → stay put.** Camera doesn't move; only
  `controls.target`, `controls.minDistance`, and focus state update.
- **`eyeDist > parkDist` → lerp.** Camera position lerps from
  `fromPos` to `toPos = target + (eye-direction × parkDist)` and
  camera orientation slerps in parallel from `fromQuat` to a quaternion
  that looks at the target from `toPos`. Both interpolations are
  driven by the same smoothstep, so the camera continuously rotates
  toward the new target as it flies in — "start view → pointing at
  new star from same location → flying right up to it, still facing it"
  as one continuous animation, not phased like the warp. Builds the
  lerp **after** `setFocus` recentres the floating origin so
  `fromPos` / `toPos` live in the post-recentre frame.
- **`opts.animate === false`** (URL restore) bypasses the lerp and
  snaps to the park pose. Matches the existing `unfocus({animate:false})`
  contract for URL-driven state restoration.

`controls.enabled` is **not** toggled during the lerp — the `animate()`
dispatcher routes through `updateFocusLerp` before `controls.update()`,
so user drag accumulates inside `TrackballControls` without visible
effect until the lerp lands. Disabling explicitly would race
`TrackballControls`' pointerup handler (Stellata's pointerup → focus
click runs *before* TC's dynamically-added pointerup), leaving TC's
`_state` stuck at `ROTATE` and the cursor "captured" until the next
click. Same precedent as the unfocus lerp (`src/client/camera/observe/README.md`).

The focus-star pin (`uPinFocusToCenter`) is suppressed while the lerp
is in flight — `controls.target` is already `(0,0,0)` in the
post-recentre frame, so the pin would otherwise snap the focal star
to NDC origin while the camera is mid-rotation, making the star
appear pasted at screen centre instead of following the rotation
naturally.

`#overlay` (HUD arrows + ring, focus ring, distance vector,
constellation lines, POI labels, etc.) is hidden for the lerp's
duration via a `body.focus-lerping` class — same mechanism the warp
uses (`body.warping`), CSS rule shares the selector. Stellata fires
the `'focusLerp'` event on start / end edges; `main.ts` toggles
the body class.

`CAMERA_LERP_MS = 2000` is the canonical 2 s constant for non-warp
camera lerps — `AIM_T_MAX_MS` and `FOCUS_LERP_MS` alias it so the
focus-park glide and aim animation read as the same family. The warp's
`WARP_REORIENT_MS = 1800` was once part of this family but tuning
moved it slightly under the canonical lerp — the reorient phase reads
snappier than a generic camera glide. `WARP_T_K_MS = 3000` is a
separate literal — a log-scale flight coefficient (see
`src/client/camera/warp/README.md`), not a duration.

`cancelFocusLerp` is wired at every site that already calls
`cancelUnfocusLerp` (`focusStar`, `flyTo`, `unfocus`, `startWarp`,
`aimAt`, `aimAtConstellation`, `onPointerUp`) so a follow-up
camera-changing action can't race the in-flight lerp.

## TrackballControls tuning

We're using `TrackballControls`, not `OrbitControls`, because the user wants
unbounded orbit past the poles (`OrbitControls` clamps polar angle, stalling
at the zenith/nadir — you'll see `cx=0` in the URL when it happens).

Current settings:
- `rotateSpeed = 3.0` (TBC defaults high; 3 feels natural)
- `zoomSpeed = 1.1`
- `panSpeed = 0.6`
- `dynamicDampingFactor = 0.15` (this is the damping knob; not
  `enableDamping`/`dampingFactor` like OrbitControls)
- `staticMoving = false` (keeps damping on)
- `noPan` starts `true`; `shift-pan.ts` toggles it per-press (see
  § Shift-drag panning). Right-drag no longer pans.
- `minDistance = GLOBAL_MIN_DIST_PC = 5e-3` (when no star is focused;
  per-star `minOrbitDistForStar` overrides on focus). `maxDistance = 100_000`.

## Shift-drag panning

Camera translation is deliberately orbit-first: a plain drag orbits;
you pan only while holding either Shift key and dragging. `shift-pan.ts`
(bound in `stellata.ts`) drives this through TrackballControls' own
key-pan mechanism rather than a parallel input path:

- TrackballControls forces any active drag into a pan while
  `keys[STATE.PAN]` (index 2 of the `keys` array) is the held key **and**
  `noPan` is `false`. It reads both in its bubble-phase `keydown`.
- We start `noPan = true` (so a plain drag orbits and the old implicit
  right-drag pan is gone) and set `keys = ['', '', 'ShiftLeft']` — the
  empty ROTATE/ZOOM slots also retire the default A/S/D drag-mode keys,
  which otherwise collide with the `S` grid / `D` debug shortcuts.
- A **capture-phase** window `keydown` (fires before TrackballControls'
  bubble handler) retargets `keys[2]` to whichever Shift is down —
  `ShiftLeft` or `ShiftRight` — and lifts `noPan`. `keyup` restores
  `noPan = true`. Releasing Shift mid-drag hands the drag back to orbit.

## Two-finger roll gesture (platform-split)

`stellata.ts` adds a two-finger rotate gesture that rolls the view around
the center of the screen by rotating `camera.up` around the forward vector
(`target - position`). TrackballControls reads `camera.up` every `update()`,
so the new orientation persists through subsequent orbit/zoom without
touching the controls' internals.

Implementation split:

- **Mobile / touch** — listens for `touchstart`/`touchmove` with exactly two
  touches, computes the `atan2` angle between them, and applies the delta
  per move. Single-finger drags are ignored (TrackballControls handles them
  via pointer events, separate from the touch event stream, so there is no
  conflict).
- **Desktop Safari** — listens for the non-standard `gesturestart` /
  `gesturechange` events (WebKit only). `event.rotation` is degrees,
  cumulative since `gesturestart`, positive clockwise. We `preventDefault`
  to suppress Safari's page-level zoom; TrackballControls still receives
  the accompanying wheel events for pinch-zoom.
- **Chrome / Firefox on desktop** — no rotate gesture exists in those
  browsers (two-finger trackpad is scroll-only, pinch fires wheel+ctrlKey
  but no rotation). Roll is unavailable there by design. Do not spend
  effort trying to polyfill it.

Sign convention: finger rotation CW on the screen → world rotates CW.
`rollCamera(-delta)` achieves this because `applyAxisAngle(forward, θ)`
rotates `camera.up` CCW when viewed from behind the forward vector
(standard right-hand rule), and rotating `up` CCW in world space makes
world content appear CW in the camera's view.


## Aim controller (`camera/aim-controller.ts`)

`AimController` owns the two aim-slerp state machines:

- **navigate slot** — orbits the camera around `controls.target` at
  constant radius, slerping two quaternions that rotate `WARP_BASE_DIR`
  to the start / end radial directions. Disables TrackballControls for
  the duration so its damping doesn't fight the slerp. The pivot is the
  **live** `controls.target`, never a snapshot: focal-frame translations
  mid-aim (orbital ride, epoch re-advance follow) carry the whole orbit
  rigidly instead of the tick snapping the camera back to a stale pivot
  every frame. The end direction stays click-time by design — under fast
  time-scrubbing the aim lands where the object was at click.
- **observe slot** — camera position is fixed at the focal star's local
  origin; only the camera quaternion changes, slerping the live pose
  toward a `lookAt(point)` target. Disables `ObserveControls` so a stray
  drag doesn't fight the slerp.

Both branches share `aimDurationMs`: a linear ramp from `AIM_T_MIN_MS`
(floor for trivial nudges) to `AIM_T_MAX_MS` (cap for a half-circle
swing). The observe branch's swing angle uses the geodesic quaternion
formula `2·acos(|q0·q1|)`; the navigate branch uses the planar
`acos(dir0·dir1)` between unit direction vectors.

Composition split — `Stellata.aimAt(pointLocal)` is the dispatcher that
owns the cross-controller busy gates (`warp.isActive()`,
`cancelUnfocusLerp`, `cancelFocusLerp`, `isObserveTransitionActive`)
before delegating to `this.aim.aimAt(pointLocal)`. The controller knows
only the mode it runs in and its own slot state.

Cancellation contract — `aim.cancel()` drops both slot states but does
**not** touch `controls.enabled` or call `observeControls.enable()`.
That re-enable only happens on natural completion of the slerp.
Cancellation sites (warp start, observe-exit, focus change while in
observe) are moving control elsewhere and own the next input-handler
transition themselves.

## Picking a constellation aims the camera

`Stellata.aimAtConstellation(conIndex)` swings the camera so the chosen
constellation is centred in view, without moving `controls.target` or
changing orbit radius — only the camera's position on the orbit sphere
moves. The aim point is the brightness-weighted centroid of the top-8
figure stars as ranked by apparent magnitude **from the current orbit
target** (not from Sol). This matters when the user has travelled far
from Sol: the same constellation is still centred on whichever members
visually dominate from *there*, not from Earth.

Called **only from the constellation dropdown change handler** in
`controls.ts`. URL state restore, reset button, and any other path that
sets `highlightCon` via `setFilter` deliberately do **not** trigger the
aim — a shareable URL's camera pose is authoritative, and the "reset"
button means "clear the selection", not "jump somewhere".

In OBSERVE mode the orbit-pivot rotation is degenerate (camera ≈
target), so `aimAtConstellation` instead routes the centroid through
`aimAt(c)`, which slerps the camera quaternion in place — same code
path Sol/GC label clicks use.
