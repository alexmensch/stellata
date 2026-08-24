# OBSERVE camera mode

A second camera mode that parks the camera at the focused hard-kind
object — star, planet, or probe, one path for all three — and swaps
`TrackballControls` for a custom look-around controller. Drag
mechanics, momentum, FOV-on-wheel, aim slerps, POI dispatch, and the
click handlers (single = pin a POI, double = aim-at).

## Files

- `observe-controls.ts` — custom look-around controller: drag
  mechanics, momentum, FOV-on-wheel, single/double click handlers
  (pin POI / aim-at).
- `look-pin-pure.ts` (+ test) — the `controls.target` value OBSERVE
  serialises, and the single condition that invalidates it.
  § The serialised look pin.
- `observe-transition.ts` — navigate↔observe FSM. `setMode`,
  `startExit`, `startUnfocusLerp`, the per-frame lerp, and the
  `ObserveFocusOps` cross-controller seam (implemented by
  `FocusController` in `../focus/`). The observe→navigate seam hands roll
  back through `ReferenceUpController.adoptFromCamera`
  (`../controls/input/README.md` § Reference up axis) — writing `camera.up`
  alone would be overwritten by the next frame's correction, restoring
  the pitch-snap bug the re-anchor exists to prevent.

Public surface of `ObserveTransition`:
- `setMode(mode, opts)` — mode-pill toggle, keyboard O, URL restore.
- `startExit(opts)` — search-row X-button (`clearFocusOnExit`),
  `FocusController.unfocus()`'s observe-animated branch.
- `startUnfocusLerp(from, to, finalMinDist)` — `FocusController.unfocus()`'s
  navigate-mode close-zoom branch.
- `tick(nowMs)` — animate-loop dispatcher.
- `isActive` / `isAnyActive` / `getProgress` — observer predicates;
  `isActive` excludes the `unfocus` kind so overlays gating on observe
  visibility stay steady-state-navigate during close-zoom.
- `cancelUnfocusLerp` — `FocusOps` shim for `WarpController`.
- `cancelTransition` — used by `FocusController.setFocus`'s observe-cleanup
  branch when the focal star is changing mid-flight.
- `dispose` — for `Stellata.dispose`.

## Entering OBSERVE

Toggled
via the navigate / observe pill in the top-right card (`#mode-toggle`,
wired in `mode-toggle.ts`). The OBSERVE button is disabled until a
hard-kind object (star / planet / probe) is focused — the underlying
`setCameraMode('observe')` no-ops without an anchor, but disabling the
button advertises the affordance up-front. Soft kinds (cloud / LG)
can't anchor observe: their focus doesn't recentre the floating
origin, and parking a camera exactly on an un-recentred object would
sit in the float32 cancellation regime.

**Camera state on enter:** position lerps to the focal object's
**live** local position (a star's catalog baseline + orbital
perturbation; a planet's body-field position) over
`OBSERVE_TRANSITION_MS = 1800 ms`. Parking at the bare origin would
leave the camera off an orbiting focal. The focal body stays visible
across the glide and is hidden via `setFocalBodyHidden` only at
`ObserveTransition`'s `enter` finish branch — once the camera is
parked on top of it. Hiding it at transition start would feel like the
object vanishes before the camera arrives. The hide dispatches per
kind in `stellata.ts` (star → the star pipeline's `uHideFocusIdx`;
planet → the body field's `uHideIdx`, which also drops the body's
label; probe → the marker field's hidden slot, which drops the marker,
its label, and its trail together). `controls.enabled = false`; `observeControls.enable()` after
the transition completes. The `animate=false` URL-restore path skips
the transition and hides immediately, since there's no glide to defer
to.

**Look-around controller (`observe-controls.ts`) — direct manipulation:**
- Drag grabs whatever world point sits under the cursor at pointer-down
  and keeps it under the cursor for the rest of the drag. Like
  fingertip-dragging the inside of a celestial sphere.
- **Mechanism.** On pointer-down, `pixelToWorldDir` converts the cursor
  pixel into a world-space ray direction `dGrabbed` — built from
  FOV/aspect and rotated by the live `camera.quaternion`, no
  `unproject()` (avoids depending on `matrixWorld` being up-to-date,
  which matters because pointer-move can fire multiple times between
  frames). On every pointer-move we recompute the cursor's world
  direction `dCurrent` the same way and pre-multiply
  `camera.quaternion` by the shortest rotation
  `setFromUnitVectors(dCurrent, dGrabbed)`. Premultiply rotates the
  camera's basis in world space; the pixel under the cursor — whose
  *camera-local* direction is fixed by FOV/aspect/pixel — therefore
  now points at `dGrabbed` in world. Repeat per move event and the
  grabbed world point is glued to the cursor pixel-perfectly.
- **No fixed yaw axis, no pole singularity, no pitch clamp.** Each drag
  rotates around whatever screen-relative axis matches the cursor
  motion. Shortest-path rotations are well-defined through ±90°, so a
  vertical drag passes straight over NGP and out the far side without
  the camera getting stuck.
- **Roll-independent.** In observe the **quaternion is the roll
  authority** — a direct-manipulation drag rotates about whatever
  screen-relative axis matches the cursor, so it accumulates roll by
  construction, and that is wanted here. The reference up axis therefore
  *follows* the camera every frame (`adoptFromCamera`) instead of
  correcting it: the URL encodes that axis, and a stale one would lose
  the roll on reload, since URL restore rebuilds the quaternion from
  cam/tgt/up before observe is engaged. A twist changes which world point
  sits under each pixel, but pointer-down captures whatever's under the
  cursor at that moment and pointer-move keeps it there — so the user can
  rotate the screen image to match the sky overhead and dragging still
  drags the world along intuitively.
- **Drag teardown.** Four code paths reset `dragging` /
  `activePointerId` / `momentumSpeed` / `lastRotAngle` to known-clean
  state via the shared `cancelDrag()` helper: `disable()` (mode change),
  `pointercancel` (OS-cancelled gesture — phone-call interrupt, system
  gesture preempt), `window.blur` (Cmd-Tab / app-switcher), and
  `document.visibilitychange` while hidden (tab swap, swipe-up app
  switcher on mobile). All four are "the pointer is no longer ours"
  events; without one of them, dragging would resume from a stale
  `dGrabbed` and the next pointermove would whip the camera. The
  navigate-mode click detector in `stellata.ts` has a parallel
  `pointercancel` partner clearing `pointerDownAt` to prevent phantom
  clicks from cross-gesture drift.
- **Release momentum.** On `pointermove` we extract the per-event
  rotation as axis-angle (`lastRotAxis`, `lastRotAngle`,
  `lastMoveTimeMs`). On `pointerup`, if the gap between the last move
  and the release is ≤ `MOMENTUM_MAX_RELEASE_GAP_MS` (80 ms — releases
  after a longer pause are deliberate stops, not flicks), we promote
  that to an angular velocity (`momentumAxis`, `momentumSpeed` in
  rad/sec). `update()` runs every frame from Stellata's animate loop
  while in observe (and not in a transition / aim slerp): it applies
  `momentumSpeed · dt` of rotation around `momentumAxis` and decays
  `momentumSpeed` by `exp(-dt / MOMENTUM_TAU_SEC)` per step. `dt` is
  capped at 100 ms so a stalled rAF (background tab, GC pause) doesn't
  resume with one giant rotation. `MOMENTUM_TAU_SEC = 0.4` is looser
  than TrackballControls' navigate damping by design — the direct-manip
  drag has no "throw" of its own, so a longer glide (~2 s before fully
  stopped) gives flicks somewhere to land. A new `pointerdown` zeroes
  `momentumSpeed` so the user can grab and stop instantly.
- **Aim-at slerps preserve roll.** `aimAt`'s OBSERVE branch builds the
  target via `Matrix4.lookAt(pos, point, camera.up)`, and the per-frame
  adopt keeps `camera.up` equal to the rendered screen-up — so the
  endpoint carries the user's current roll into the new view direction
  instead of unwinding it. Before the reference-up axis landed, `up` was
  only written by the twist gestures, so any direct-manipulation roll was
  stale by the time an aim read it and the slerp snapped the image back
  toward ICRS Y.
- Wheel adjusts `camera.fov` (1.5° per notch, clamped to
  `FOV_MIN_DEG`–`FOV_MAX_DEG` = 10–120° from `../timing.ts`) instead
  of camera distance. Distance has no meaning when the camera is
  parked. `FOV_MAX_DEG` is load-bearing beyond this controller — it is
  the worst case the camera near plane is validated against
  (`../README.md` § Shared). Trackpad pinch reaches this same handler:
  `InputController` normalises it to whole wheel notches rather than
  forking a pinch→FOV path (`../controls/input/README.md` § Pinch-to-zoom).
- In navigate-mode, `rollCamera` re-tilts the reference up axis, and the
  per-frame correction derives `camera.up` from it (TrackballControls
  rebuilds the quaternion from `camera.up` on every `update()`). In
  observe-mode it rotates `camera.quaternion` — the rendered roll — and
  the reference re-adopts from it. Shift+drag fires in both modes — armed
  and disarmed live by the Shift key, mid-drag — and the look-around drag
  bails out of a shifted pointerdown so the two never process the same
  gesture. `../controls/input/README.md` § Roll gestures carries the input paths
  and the mid-roll snap-to-level guide.

**HUD locators:** Sol and Galactic-Centre arrows are part of the HUD
(`hud-overlay.ts`, gated by `filter.showHud`). In observe their anchor
falls back to screen centre (the focal-star projection is degenerate
since camera ≈ focal star) and the shaft start radius equals the HUD
ring's `ringRadiusPx(fov, w, h)` so the arrows attach to the ring rim
and swivel around it. The same shaft-start value lerps through the
navigate↔observe transition so there's no pop on entry/exit.

**Aim from observe:** `aimAt(localPoint)` (Sol/GC labels +
constellation typeahead) has an observe-mode branch that builds a
target quaternion via `Matrix4.lookAt(camera.position, point,
camera.up)` and slerps the live quaternion to it, capped at
`AIM_T_MAX_MS = 2000`. `observeControls.disable()` for the duration so
drag input doesn't fight the slerp; re-enabled at completion. The
`aimAtConstellation` path also routes here in observe — orbit-pivot
math is degenerate at observe range.

**Search row labels:** the search-tag swaps "Focus" → "Location" via
`syncFocusUI` reading `getCameraMode()` on every focus / mode change.
Soft-kind entries are filtered out of the location picker
(`focusRunQuery` in `search.ts` filters on `isHardTarget`, never on a
spelled-out kind list) — observe anchors are hard kinds only.

**Picking a new location** (any hard kind alike) routes through
`warpTo(target)` instead of `flyTo(target)`. The warp animation flies between anchors and the
post-arrival slerp leaves the camera pointing in the original celestial
direction from the new vantage. Collocated locations (α Cen A/B at one
catalog baseline, or a ρ=0 inner pair on its parent like Castor Bb→B) fly
the same path — there is no degenerate shortcut. Their A→B separation is
too small to give a reliable travel direction, so `startWarp` falls back
to the camera's current view direction (`WARP_DEGENERATE_DIST_PC`); the
near-zero flight then lands through the normal `finishWarp` →
`finishObserveAnchorSwap` re-anchor, keeping observe engaged with
`controls.target` correctly on the new star. A bespoke in-place re-anchor
was tried and reverted: it bypasses `finishWarp`'s `controls.target` setup
and desyncs the focal-frame ride.

**X button (clear focus from observe):** `unfocus()` detects observe +
hard focus and immediately clears focus *before* starting the
zoom-out animation. The search box empties via the `'focus'` event on the
click, then the camera pulls back to the former focal's park distance
along its current view direction over `OBSERVE_TRANSITION_MS`.

**Navigate-mode close-zoom unfocus** (a7d.2.6) takes the same shape:
when the user hits Esc / clicks the focused object / clicks the X while
already in navigate, and the camera sits closer than
the focal object's park distance, `unfocus()` lerps the camera outward
along its view direction to it over `OBSERVE_TRANSITION_MS`
instead of teleporting. Reuses `ObserveTransition`'s state slot with a
third `kind: 'unfocus'`. `setFocus(null)` runs at lerp start so UI clears
immediately; `controls.minDistance` is tightened to the park distance
on landing so manual zoom-in is bounded by the same parking distance.
Skipped (snap) when already at or beyond the floor; cancelled cleanly
by any new camera-changing action via `cancelUnfocusLerp` calls at
the entry points (`focusStar`, `startWarp`, `aimAt`,
`aimAtConstellation`, `onPointerUp`). `controls.enabled` is **not**
toggled during the lerp — the `animate()` dispatcher routes to the
lerp tick instead of `controls.update()`, so user input accumulates
inside TrackballControls but doesn't apply visually. Disabling
explicitly would race the click-to-unfocus event chain and leave
TrackballControls' `_state` stuck at `ROTATE`. Capturing
`forward` from the camera quaternion before the recenter (frame-
invariant) keeps the animation aimed correctly even though
`setFocus(null)` translates camera position into Sol-centric coords
mid-call.

`ObserveTransition`'s `exit` finish branch then sets `controls.target` to the
transition's `fromPos` (the observed star's live location — observe parks
at it — in whichever frame is current). Three reasons:
- The exit translates the camera backward along its forward direction
  by `minDist` (`toPos = fromPos − forward·minDist`), so `fromPos` lies
  exactly along forward at that distance — `TrackballControls.update()`'s
  built-in `lookAt(target)` is therefore a no-op for orientation, and the
  user keeps facing whatever they were observing.
- `fromPos` is the focal star's live position, so target lands on the
  star and the navigate-mode pin re-engages (its guard compares target to
  the star's live position). Setting `target = (0,0,0)` would point at
  the local-frame origin — the star's *baseline*, not its perturbed
  position — leaving the pin disengaged and the disc off-centre for a
  binary member.
- Using `fromPos` works for both the unfocus path and the focus-retained
  path because each captures `fromPos` from the camera position right
  before the lerp begins — whatever frame the camera is in, `fromPos` is
  along the forward ray at minDist, which is what we want lookAt to be a
  no-op against. The focal-frame ride translates `fromPos`/`toPos`
  per frame so the pull-out stays locked to the drifting star.

## The serialised look pin

`controls.target` has **no geometric job in OBSERVE** — TrackballControls
is swapped out, so there is no orbit pivot. It survives as a
*serialisation shim*: the URL blob has no field for orientation, it stores
two points (`cam`, `tgt`) and rebuilds the look direction with `lookAt` on
load. So the shell manufactures a `tgt` one parsec along the camera's
forward axis (`LOOK_PIN_DIST_PC`). The distance is arbitrary — any
non-zero value encodes the same direction — and the pin's only consumer is
the URL writer. `scale-bar.ts` branches to angular extent in OBSERVE and
never reads it; the galactic arrows deliberately use the focal position
instead (`../../galactic/README.md`), since a target-based origin would
report every distance ~1 pc off.

**It is re-derived only on rotation, and that guard is load-bearing.** A
focal ride translates camera and target together through one delta
(`Stellata.applyRideDelta`), which is exact, so a translated pin stays
correct for free. Re-deriving it from a translated camera instead —
which is what the shell used to do every frame — lands
`position + forward` a few ULP off the value the ride wrote, every frame,
converging never. The render gate compares the pose by exact equality, so
it read that as a camera move and the whole clock cadence stopped idling
(`../../render-gate/README.md` § Pose change).

The 1 pc distance is what makes it worst: `position + forward × 1pc`
differences two near-equal magnitudes when the camera sits about a parsec
from the local origin looking back toward it, and the drift there measured
~3900 ULP per tick against ~1 elsewhere. `observePinQuat` is NaN-seeded so
the first frame always derives, and the `'cameraMode'` handler re-seeds it
because the transitions write `controls.target` directly — without that, a
mode round-trip with no rotation would keep the transition's target as the
pin.

**URL state:** the OBSERVE-mode flag round-trips through the `?v=`
blob (flags-byte bit 5), applied after camera params +
`controls.update()` so the saved pose lands first. The URL writer's
debounced frame hook skips writes during
`isCameraTransitionActive()` — covers warp, observe enter/exit, and
the navigate-mode unfocus lerp (a7d.2.6) so transient mid-lerp poses
don't get serialised. URL apply for `focus: 'cleared'` calls
`unfocus({ animate: false })` so a state restore doesn't fight a
following `view.cam` write.

**Click dispatch in OBSERVE.** Canvas clicks in both modes route
through the shared `PendingClickDispatcher`
(`src/client/util/pending-click.ts`): singles are held for
`DBL_CLICK_MS = 280`; a second click within that window AND within
`DBL_CLICK_DIST_PX_SQ` (8 px²) of the first cancels the pending
single and fires a **double-click** instead.

- *Single-click:* `picker.pickStar()` resolves the click; if a star is
  hit, `applyObjectClick()` toggles its pin (`togglePoi`). Pin
  eligibility + cap semantics live in `src/client/poi/README.md`. The
  POI overlay renders the resulting label + arrow.
- *Double-click:* unprojects the click into a world-space ray, builds
  a far point along it, and feeds that to `aimAt()` — the existing
  observe-aim path slerps the camera so the clicked direction lands
  at view centre. Works on stars, on empty sky, and on chart-mode
  background alike.

POIs persist across observe ↔ navigate transitions — one shared list
for both modes (`src/client/poi/README.md`) — and round-trip through
the `?v=` blob in any camera mode, encoded as SIDs at bit 19.

## ObserveTransition kinds

`observe-transition.ts` reuses one state slot for three kinds:

- **`enter`** — animated navigate → observe entry. Lerps
  `camera.position` to the focal star's live local position (baseline +
  perturbation, via `ObserveFocusOps.focalLocalPositionInto`) over
  `OBSERVE_TRANSITION_MS = 1800` with an inline time-smoothstep. The
  focal-frame ride translates the in-flight `fromPos`/`toPos` so the
  glide stays locked to the star.
  The focal-body hide is held off across the glide; the finish branch
  hides the focal body (`setFocalBodyHidden`) and enables
  `ObserveControls`.
- **`exit`** — animated observe → navigate exit. See § X button and
  § Navigate-mode close-zoom unfocus above for both code paths.
- **`unfocus`** — navigate-mode close-zoom outbound park-arrival.
  Reuses the state slot but isn't an observe transition; delegated to
  `../arrival/camera-motion.ts:tickArrival` so focus-park, warp Fly,
  and unfocus all share one arrival profile. `isActive()` and
  `getProgress()` exclude it so overlays gating on observe visibility
  stay steady-state-navigate during close-zoom; `isAnyActive()` is
  the union, used by `FocusController.isCameraBusy()`.

Cross-controller coupling lives behind the `ObserveFocusOps`
interface (declared in `observe-transition.ts`): focused-star
inspection (`getFocusedHardTarget`), `hardFocusParkDist` lookup,
vector-slot clears at observe
entry, `setFocus` on `clearFocusOnExit`, and the `isCameraBusy` gate
`setMode` consults before claiming the camera. `FocusController` (in
`../focus/`) is the implementor.

`FocusController` owns the `cameraMode` field (~20 unrelated read
sites) and `ObserveTransition` writes it through the
`setCameraModeValue` dep callback so the controller's state machine
stays the canonical mode-switcher. `FocusController.setFocus`'s
observe-cleanup branch is the
one remaining inline writer that bypasses `startExit` — it calls
`observe.cancelTransition()` to clear any in-flight slot, then sets
`cameraMode = 'navigate'` and runs an abbreviated snap (no
`controls.target.set(0,0,0)`, no `controls.update()`) because the
focal star is changing and the target needs to wait for the
downstream `recenterFocusToStar` block.
