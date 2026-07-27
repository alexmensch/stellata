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
  cloud click semantics) and every roll gesture — Shift-drag, two-finger
  twist, Safari trackpad (see § Input controller, § Roll gestures).
- `reference-up.ts` (+ test) — `ReferenceUpController`: the persistent
  reference up axis and the per-frame `camera.up` correction (see
  § Reference up axis).
- `reference-up-pure.ts` (+ test) — the roll algebra: level-up
  projection, pole-cone weight, signed roll angles, camera-local up.
- `mode-toggle.ts` — navigate / observe pill in the topbar.
- `picker.ts` — pure target resolver; click + hover pick paths for
  stars / clouds / planets / probes / Local Group / heliopause /
  boundary shells (`pickShellHit`, shared silhouette helper in
  `fresnel-shell/`). `pickProbeHit` reduces through the same
  `pickFromCandidates` two-tier contract as every other layer, with
  `PROBE_MARKER_PX` as its fixed prime hit radius. The two
  cloud surfaces (`pickCloud` / `pickCloudHit`) hold only their own gates
  — warp and `group.visible` respectively — and delegate the winner to
  `MolecularClouds.pick` so click and hover can't disagree
  (`../../molecular-clouds/README.md` § Picking + hover). Both star pick
  surfaces route the winner through `resolveCollapsedLead` (backed by
  the system-membership registry — `src/client/system-membership/`):
  a member of a collapsed cluster resolves to the cluster's primary, so
  the hover card, POI pin, vector, and focus all act on the object the
  user sees as "the point" (never an arbitrary closest-to-camera
  member). Identity for unsuppressed stars — a focused member's
  relations bypass the LOD gates, so focused-star click semantics are
  untouched. The planet pick needs no lead rewrite: a body collapsed
  onto its parent drops out of `PlanetBodyField.pick`, so the parent's
  own pick surface (the star picker for a host, the parent planet for
  a moon) wins the point.
- `aim-controller.ts` — mode-aware aim slerps (navigate orbit-pivot
  + observe quaternion-in-place), shared `aimDurationMs` ramp.
- `star-geometry.ts` — pure star angular-geometry formulae
  (θ = 2·atan(R/d), `parkDistForStar` derivations).
- `star-physics.ts` — per-star camera/screen geometry: `fovMinorRad`,
  `peakAmplitudeFactor`, `minOrbitDistForStar`, `parkDistForStar`,
  `renderedSizePx` (+ its `renderedSizeComponents` split — the star
  local cluster's disc/glow membership test reads the two size terms
  separately), `renderedDiscPxAtPeak`, `getChartDiscParams` +
  canonical `ZOOM_FLOOR_FRACTION`, `VAR_TROUGH_FLOOR_FRACTION`. The
  planet siblings `minOrbitDistForPlanet` / `parkDistForPlanet`
  (+ `PLANET_PARK_FILL_FRACTION`) live here too — same angular
  solves, keyed on the body radius directly. `PROBE_ORBIT_FLOOR_PC` /
  `PROBE_PARK_DIST_PC` break that pattern deliberately: they are fixed
  distances, not solves, because a probe marker is a fixed-pixel glyph
  with no disc to fill and its metre-scale hull would solve to a park
  inside `CAMERA_NEAR_PC` (`../depth-range.test.ts` pins the margin;
  `../../solar-system/probes/README.md` § Park distance carries the
  derivation).

### star-geometry vs star-physics vs stellata.ts

- `star-geometry.ts` — pure formulae (no catalog, no uniforms).
- `star-physics.ts` — catalog-indexed wrappers around those formulae.
- `stellata.ts` — wires per-frame uniforms and dispatches.

## Input controller

`InputController` owns every canvas pointer listener: pointerdown /
pointermove / pointerup / pointercancel (the click FSM + Shift-drag
roll) and the touch + WebKit gesture events (two-finger roll). Clicks in
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
state. Roll math delegates to `ReferenceUpController`, which owns the
scratch vectors; the per-gesture-event path allocates nothing.

## Camera near plane vs controls minDistance

`camera.near = CAMERA_NEAR_PC = 1e-12` (`../timing.ts`; the pair is
pinned by `../depth-range.test.ts` — see `../README.md` § Shared for how
thin the smallest-moon margin actually is), `controls.minDistance` (when
no star is focused) = `GLOBAL_MIN_DIST_PC = 5e-3` pc. The unfocused floor sits well above
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

## Focus-park lerp

`../focus/README.md` § Focus-park lerp owns this — the stay-put/lerp
branch, the `controls.enabled` contract, the pin suppression, and the
overlay hide. Two things that belong here rather than there:

`CAMERA_LERP_MS = 2000` is the canonical 2 s constant for non-warp
camera lerps — `AIM_T_MAX_MS` and `FOCUS_LERP_MS` alias it so the
focus-park glide and aim animation read as the same family. The warp's
`WARP_REORIENT_MS = 1800` was once part of this family but tuning
moved it slightly under the canonical lerp — the reorient phase reads
snappier than a generic camera glide. `WARP_T_K_MS = 3000` is a
separate literal — a log-scale flight coefficient (see
`../warp/README.md`), not a duration.

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
- `dynamicDampingFactor = 0.15` (this is the damping knob; not
  `enableDamping`/`dampingFactor` like OrbitControls)
- `staticMoving = false` (keeps damping on)
- `noPan = true`, permanently — there is no camera-translate gesture at
  all (orbit, dolly, roll). `panSpeed` is therefore unset: `update()`
  never calls `panCamera`. Note `checkDistances` (the min/max-distance
  clamp) only runs while `!noZoom || !noPan`, so it survives on `noZoom`.
- `keys = ['', '', '']` — empty drag-mode slots retire TrackballControls'
  A/S/D defaults, which otherwise swallow the `S` grid and `D` debug
  shortcuts. Load-bearing; don't restore the defaults.
- `noRotate` is toggled for the duration of a Shift-drag roll (see
  § Roll gestures).
- `minDistance = GLOBAL_MIN_DIST_PC = 5e-3` (when no star is focused;
  per-star `minOrbitDistForStar` overrides on focus). `maxDistance = 100_000`.

## Reference up axis

`camera.up` is **derived state**. The roll authority is
`ReferenceUpController`'s single unit vector — the *reference axis*,
galactic north (`GALACTIC_NORTH_POLE_ICRS`) by default, written only by
an explicit roll gesture, the snap-to-level, or a URL restore. Every
frame, ahead of the whole animation dispatch in `stellata.ts`'s
`animate()`:

- **NAVIGATE** — `correct(camera)` rotates `camera.up` back toward the
  reference about the view axis. Must run *before* `controls.update()`
  and every animation tick, because every navigate-mode orientation
  source is a `lookAt` reading `camera.up`.
- **OBSERVE** — `adoptFromCamera(camera)` instead: there the quaternion
  is the roll authority (direct-manipulation drag rolls by construction),
  so the reference *follows* the camera. That keeps the axis truthful for
  URL round-trip and makes the observe→navigate handover a no-op.

### Why the correction exists

Orbit drift is **parallel-transport holonomy**, not input noise. A single
TrackballControls rotate step turns `_eye` and `camera.up` by the same
quaternion about an axis ⊥ eye, injecting zero roll — but any closed drag
loop returns with a net roll equal to the enclosed solid angle. A
diagonal-drag filter can't fix that (an axis-aligned right/up/left/down
loop encloses area too); only re-deriving the up from a reference can.
TrackballControls also keeps rotating `up` through its damping tail after
pointer-up, so the correction has to be per frame, not per input event.

### The pole cone

`levelUpInto` (the reference projected into the image plane) is
ill-conditioned when the view axis approaches the reference axis, and the
180° flip there is *inherent*: "north stays up" from the far side of the
pole IS the flipped image. So correction strength is
`poleConeWeight(sin θ)` — a smoothstep that reaches 1 outside a
`POLE_CONE_DEG` = 15° cone and eases to 0 on the axis. Outside the cone
the view is exactly level in one frame; inside it, TrackballControls'
transported up governs, so orbiting over the pole neither whips nor
stalls (the freedom TrackballControls was chosen for), and the 180°
re-level unwinds smoothly on the way out. Strength is a function of
geometry, not of `dt` — no time constant to tune. Consequence to expect:
because the correction reads the *previous* frame's view axis, a
continuous drag leaves a sub-degree residual that settles as soon as the
pointer stops.

### The slerp-endpoint rule

Camera animations split into two classes, and only one needs care:

| class | orientation source | sites |
|---|---|---|
| **A** | per-frame `lookAt`, reads `camera.up` | TrackballControls steady state, warp reorient (navigate launch), warp Fly, warp finish (navigate), the navigate aim tick (its `q0`/`q1` slerp drives *position*), observe exit's no-op `lookAt` |
| **B** | a quaternion captured up-front, then slerped | focus-park lerp `qEnd`, warp reorient (observe launch), warp phase 3, observe aim `q1` |

Class A inherits the correction for free. **Class B endpoints must
resolve roll against the reference axis, never the live `camera.up`** —
the end pose looks down a different axis than the start, so an endpoint
built from the start-pose up lands on a roll the steady-state correction
then has to undo, one frame after the animation settles. That is the pop
`focus-transition.ts`'s `referenceUp` parameter exists to prevent
(`focus-transition.test.ts` pins both directions). The observe-mode
Class-B sites read `camera.up` and stay correct because the per-frame
adopt keeps it equal to the rendered screen-up.

Nothing has to suspend the correction during a Class-B slerp: it only
writes `camera.up`, which no one reads while a slerp owns the quaternion,
and the value it converges on at the end pose is exactly what the
endpoint was built from.

## Roll gestures

Three input paths, one dispatch (`InputController.rollCamera`): NAVIGATE
re-tilts the reference axis, OBSERVE rolls the quaternion. Both leave the
tilt persistent through subsequent orbit / dolly.

- **Shift+drag (desktop, both modes)** — the roll gesture that replaced
  Shift-pan. Roll follows the pointer's *bearing about screen centre*, so
  it reads as twisting the image; `ROLL_DEADZONE_PX` (40 px) suppresses
  sampling near centre where the bearing is unstable. A roll gesture
  clears `pointerDownAt`, so it can't also dispatch a click.
- **Mobile / touch two-finger twist** — `atan2` angle between two
  touches, delta applied per move. Single-finger drags are ignored
  (TrackballControls handles them through pointer events, a separate
  stream).
- **Desktop Safari** — the non-standard `gesturestart` /
  `gesturechange` / `gestureend` trio (WebKit only). `event.rotation` is
  cumulative degrees since gesture start, positive clockwise; we
  `preventDefault` to suppress Safari's page zoom, and TrackballControls
  still gets the wheel events for pinch-zoom. Chrome / Firefox expose no
  rotate gesture — Shift-drag is the roll path there. Do not try to
  polyfill.

### Shift is a live modifier, not a gesture mode

Roll arms the instant either Shift goes down and disarms the instant it
comes up, **mid-drag, in both directions** — an orbit drag becomes a roll
and back again without releasing the mouse. `keydown`/`keyup` on
`window` (capture phase, matching `e.key === 'Shift'` so either physical
key works) drive it; `InputController` tracks the live pointer separately
from the click FSM's `pointerDownAt` so a mid-drag arm can seed its
bearing from the current position.

This is safe only because of how TrackballControls advances its drag
delta: `onMouseMove` does `_movePrev.copy(_moveCurr)` before storing the
new position, so the frames `noRotate` skips are **discarded, not
accumulated**. Orbit resumes from the next move rather than snapping
through the whole roll excursion. (`rotateCamera` also advances
`_movePrev`, which is what an earlier read of the library suggested was
the only place — hence an initial design that sampled Shift once at
pointerdown and stuck with it for the gesture. That stickiness was
unnecessary and read as a bug.)

`window`'s `blur` also disarms: a Shift release that never reaches us
(Cmd-Tab, app switcher) would otherwise latch the roll and leave orbit
dead — the worst version of sticky.

Sign convention: pointer/finger rotation CW on screen → world rotates CW.
`rollCamera(-delta)` achieves this because `applyAxisAngle(forward, θ)`
rotates CCW viewed from behind the forward vector (right-hand rule), and
rotating the reference CCW in world space makes content appear CW.

### Snap-to-level — an alignment guide, not a release-time fixup

While rolling, the view **sticks** to galactic level for as long as the
requested roll stays inside `SNAP_TO_LEVEL_DEG` (1°) of it: the image
visibly stops rotating at level, then breaks free on the way out. That
stick *is* the feedback — the same affordance as Keynote / PowerPoint
alignment guides. A release-only snap gives the user no way to feel where
level is, which is the point of having it.

`applyRollDelta` implements it against a **virtual roll**: while snapped,
`rollSnapExcursion` keeps accumulating what the pointer asked for while
the camera holds still, and the gesture leaves the guide once that
virtual roll passes the band — resuming exactly where the pointer says,
not where it entered. Tracking the virtual position separately is what
makes the band un-chatterable with one threshold instead of two.

The residual is measured differently per mode, and the split is
load-bearing. NAVIGATE reads `referenceRollError` (reference vs galactic
north, about the view axis) because there the quaternion trails
`camera.up` by a frame — `lookAt` hasn't consumed the newest roll yet.
OBSERVE reads `renderedRollError` (the quaternion's own screen-up),
because that is what the user sees.

Leaving a gesture *while still on the guide* re-anchors the reference on
north **exactly** (`settleRollSnap` → `snapReferenceToNorth`). Snapping
only rolled the axis until it *renders* level from the current view
direction, and every axis in the forward/north plane does that — such an
axis would drift back off level as soon as the orbit moved.

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
