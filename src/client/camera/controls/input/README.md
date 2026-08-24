# Camera input

Canvas gestures and the camera state they drive: the click FSM, the
reference up axis that keeps the view galactic-level, the roll gestures,
and pinch-to-zoom. TrackballControls' own tuning lives here too — the
gestures below toggle its `noRotate` / `noPan` flags.

## Files

- `input-controller.ts` (+ test) — every canvas pointer / touch / gesture
  listener: the click FSM (single/double dispatch in both modes, the
  kind-generic click ladder, cloud click semantics), the roll gestures,
  and the pinch normaliser.
- `reference-up.ts` (+ test) — `ReferenceUpController`: the persistent
  reference up axis and the per-frame `camera.up` correction.
- `reference-up-pure.ts` (+ test) — roll algebra: level-up projection,
  pole-cone weight, signed roll angles, camera-local up.
- `pinch-zoom-pure.ts` (+ test) — pinch-delta → wheel-notch normalisation
  (`PINCH_NOTCH_GAIN`, `pinchStep`).
- `trackball-settle.ts` (+ test) — `TrackballSettle`: stops the damping
  tail once a frame moves less than a tenth of a pixel. § Damping settle
  floor.
- `trackball-settle-pure.ts` (+ test) — the on-screen motion of one
  frame's step (`eyeSwingRad`, `trackballMotionPx`) and the floor itself.

The click decision tables live in `../../../README.md` § Click-state
machine; the ladder's pure decision function is
`../../../poi/click-ladder-pure.ts`. Picking (`../picker.ts`), aim slerps
(`../aim-controller.ts`), and the near-plane / orbit-floor geometry stay
in the parent — see `../README.md`.

## Input controller

`InputController` owns every canvas pointer listener: pointerdown /
pointermove / pointerup / pointercancel (the click FSM + Shift-drag
roll) and the touch + WebKit gesture events (two-finger roll). Clicks in
both modes are held for `DBL_CLICK_MS` (280 ms) by a shared
`PendingClickDispatcher` (`../../../util/pending-click.ts`) so single and
double clicks disambiguate; the deferred handlers re-check the
warp / aim / transition guards at fire time. The full per-mode click
decision table lives in `../../../README.md` § Click-state machine;
the ladder's pure decision function is
`../../../poi/click-ladder-pure.ts`.

The controller sees the rest of the app only through its deps
closures (busy gates, Target-keyed focus/vector reads, flyTo /
setOrbitTarget / unfocus / togglePoi / aimAt) — it owns
dispatch order and gesture math, never focus or camera-transition
state. Roll math delegates to `ReferenceUpController`, which owns the
scratch vectors; the per-gesture-event path allocates nothing.

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
  never calls `_panCamera`. Note `_checkDistances` (the min/max-distance
  clamp) only runs while `!noZoom || !noPan`, so it survives on `noZoom`.
- **`handleResize()` has to be called on every window resize**, from
  `Stellata.onResize`. TrackballControls measures a drag against a `screen`
  rect it caches once in its constructor and never refreshes itself, and the
  rotate gesture divides by that cached width and centres on it — so after a
  resize the trackball's virtual centre sits at the old canvas centre and the
  rotation rate is scaled by the old width. Not a fat-finger bug: it survives
  a page's whole session and only ever gets worse.
- `keys = ['', '', '']` — empty drag-mode slots retire TrackballControls'
  A/S/D defaults, which otherwise swallow the `S` grid and `D` debug
  shortcuts. Load-bearing; don't restore the defaults.
- `noRotate` is toggled for the duration of a Shift-drag roll (see
  § Roll gestures).
- `minDistance = GLOBAL_MIN_DIST_PC = 5e-3` (when no star is focused;
  per-star `minOrbitDistForStar` overrides on focus). `maxDistance = 100_000`.
- `staticMoving` is also written **per frame** by `TrackballSettle` —
  § Damping settle floor. The `false` above is the seed, not a constant.

## Damping settle floor

`dynamicDampingFactor` decays the residual rotation by
`sqrt(1 − 0.15)` = 0.922 per frame and the dolly by 0.85, and
TrackballControls never zeroes either. Left alone a release therefore
runs about a second of settle you can see and then **~2.3 minutes** of
sub-pixel drift decaying toward float underflow — a tail that reads as
the view never quite arriving, and that changes `camera.position` every
frame, so the render gate can never idle after a camera move
(`../../../render-gate/README.md`).

`trackball-settle.ts` measures what each `update()` actually moved on
screen and sets `staticMoving = true` under `TRACKBALL_SETTLE_PX`
(0.1 CSS px/frame), which is the library's own path for dropping the
residuals — the rotate tail stops being applied and the dolly's
`_zoomStart.copy(_zoomEnd)` clears itself, with no reach into
underscore-private state that a three upgrade could rename.

**Why cutting at a per-frame rate is safe:** a geometric tail owes
`step / (1 − r)` in total, so at the floor the whole remaining journey
is ~13 further steps — **under 1.3 px**, discarded once. The visible
part of the settle (roughly the first second) is untouched by
construction; only the part below one tenth of a pixel per frame goes.

Two writers, in order: a `pointerdown` / `wheel` listener hands damping
back **before** the gesture's first `update()`, because that call lands
ahead of any motion the per-frame measurement could see and a wheel notch
would otherwise apply whole. The measurement then governs for the rest of
the gesture, so a drag that starts slow and speeds up re-smooths on the
frame it crosses the floor.

The floor is in **pixels** deliberately: a pixel means the same thing
from any vantage at any epoch, where a world-space or per-parsec cut-off
would settle differently at Sol and at the LMC (CLAUDE.md
§ Camera-anywhere). It is the navigate-mode sibling of observe's
`MOMENTUM_MIN_SPEED` (`../../observe/observe-controls.ts`), which has
floored its own momentum on the same argument from the start.

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

### The correction needs a deadband, or it 2-cycles

**`UP_CORRECTION_DEADBAND_RAD` (1e-4 rad) is load-bearing, and the bug it
fixes looks like nothing.** Without it the correction has no fixed point:
at level it measures a residual of order 1e-18 rad, applies it, and the
project / normalise / rotate / normalise chain lands one representable
step away — the next frame's projection brings it back, forever. Measured:
`camera.up` moved on 200 of 200 frames, alternating between two adjacent
doubles.

Every navigate-mode orientation source is a `lookAt` reading `camera.up`,
so that alternation reaches `camera.quaternion`, and the render gate's
pose snapshot compares by **exact equality** — so it saw a slot move every
tick and the view could never idle, at any vantage, with nothing
whatsoever moving on screen (`../../../render-gate/README.md`). The
readout named it `pose moved: quat.y by 1.11e-16 (1 ulp)`.

Declining to write below the band is the same hysteresis `slewDm` applies
to the exposure cut, and for the same reason: a bit-identical input
re-derives a bit-identical output, so the loop breaks at the source
instead of being filtered downstream. Three properties the band has to
keep, each pinned by test:

- **Nothing is written inside it** — not even the re-projection, which is
  a rounding step that cycled on its own.
- **A sub-band residual still accumulates.** The error is measured against
  the reference each frame rather than integrated, so holonomy drift
  crosses the band and gets corrected. A band that swallowed drift
  permanently would trade a render-gate bug for a levelling bug.
- **It is invisible.** A roll displaces a feature by `radius · angle`:
  1e-4 rad at a 1500 px screen radius is 0.15 px, under the cadence's
  0.25 device-px scheduling threshold, and four decades below
  `SNAP_TO_LEVEL_DEG`.

The measurement is also taken against `up` directly rather than its
projection — `levelUpInto`'s output is perpendicular to `forward` by
construction, so up's forward-parallel component cancels out of both the
cross and the dot and the angle is unchanged. That removes two of the
rounding steps that drove the cycle rather than merely tolerating them.

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
  `preventDefault` to suppress Safari's page zoom. The same events carry
  pinch as `event.scale` — see § Pinch-to-zoom. Chrome / Firefox expose no
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

While rolling, the view **sticks** to level for as long as the requested
roll stays inside `SNAP_TO_LEVEL_DEG` (2°) of it: the image visibly stops
rotating at level, then breaks free on the way out. That stick *is* the
feedback — the same affordance as Keynote / PowerPoint alignment guides. A
release-only snap gives the user no way to feel where level is, which is
the point of having it.

`applyRollDelta` implements it against a **virtual roll**: while snapped,
`rollSnapExcursion` keeps accumulating what the pointer asked for while
the camera holds still, and the gesture leaves the guide once that
virtual roll passes the band — resuming exactly where the pointer says,
not where it entered. Tracking the virtual position separately is what
makes the band un-chatterable with one threshold instead of two.

The residual is measured differently per mode, and the split is
load-bearing. NAVIGATE reads `referenceRollError` (reference vs the level
pole, about the view axis) because there the quaternion trails
`camera.up` by a frame — `lookAt` hasn't consumed the newest roll yet.
OBSERVE reads `renderedRollError` (the quaternion's own screen-up),
because that is what the user sees.

**Which frame is level follows the displayed coordinate sphere.** The pole
comes from `coordSphereNorthPole(filter.coordSphere)`
(`../../../galactic/coord-spheres/README.md`) — the RA/Dec sphere's own NCP
while that grid is up, galactic north otherwise. The guide has to stick to
the grid the user is levelling against; the two poles are ~63° apart, so a
frame-blind guide never engages on the sphere in front of them. Only the snap
*target* is frame-aware: the reference default, the pole-cone correction, and
the band are unchanged.

`rollSnapPole` is that pole **captured at the moment the guide engaged**, and
doubles as the "snapped" flag. `filter.coordSphere` can change *during* a roll
with no user input: a dolly (the wheel path is not blocked mid-drag) past the
RA/Dec fade demotes the selection to `none`, and `S` is live too. Re-reading
the pole on release would then settle against a frame the view never stuck to
and rotate the image by up to the ~63° between them.

Leaving a gesture *while still on the guide* re-anchors the reference on
that pole **exactly** (`settleRollSnap` → `snapReferenceTo`). Snapping
only rolled the axis until it *renders* level from the current view
direction, and every axis in the forward/pole plane does that — such an
axis would drift back off level as soon as the orbit moved.

## Pinch-to-zoom

Two browser signals, one path. **Blink** (Chrome / Edge / Firefox)
synthesises a **`ctrlKey` wheel event** for trackpad pinch. **WebKit**
does not — Safari reports pinch *only* through `GestureEvent.scale`, which
is why the `gesture*` listeners are not roll-only. Getting this wrong is
what shipped a Safari build where pinch did nothing: an earlier note in
this README claimed Safari's pinch also arrived as wheel events, so the
`scale` was left unread.

On Blink the signal did reach TrackballControls, but a pinch reports
single-digit `deltaY` per event where a notch reports 100, and TC scales
pixel-mode deltas by `0.00025` — so pinch registered as ~1/30th of a
notch: present in the code, absent in the hand.

`InputController` intercepts it, amplifies by `PINCH_NOTCH_GAIN`, and
**re-emits it as an ordinary wheel event on the canvas**, so navigate zoom
(TrackballControls) and observe FOV (`ObserveControls.onWheel`) handle
pinch through the path they already handle scrolling through — no second
zoom rate to keep in sync, and no mode branch here.

- **Capture phase on `window`.** At the target phase, listener order is
  registration order regardless of the capture flag, and TC registered its
  canvas `wheel` listener first; an ancestor capture listener is the only
  way ahead of it. `stopPropagation` then stops TC adding its
  1/30th-notch nudge on top of the re-emitted notch.
- **`pinchStep` carries the sub-notch remainder** between events so a slow
  pinch accumulates instead of rounding to nothing, and returns a signed
  *count* that may exceed one. Quantising it to ±1 is what left
  `PINCH_NOTCH_GAIN` inert: ordinary pinch events already sat at that
  ceiling, so raising the gain by orders of magnitude changed nothing.
  `MAX_NOTCHES_PER_EVENT` bounds the count — a mistyped gain must not spin
  a dispatch loop — but never binds at a sane one.
- **A `Ctrl`+wheel tick must not be amplified**, being indistinguishable
  from pinch at the event level, so deltas at or above
  `NOTCH_SCALE_DELTA_PX` pass through unamplified. This couples the two
  constants: if a notch of pinch input
  (`WHEEL_NOTCH_DELTA_PX / PINCH_NOTCH_GAIN`) ever exceeded that threshold,
  every pinch event would read as a wheel tick and the gain would go dead
  again. `pinch-zoom-pure.test.ts` asserts it doesn't.
- **Notches dispatch one event each**, not one event carrying N notches:
  `ObserveControls.onWheel` reads only the *sign* of a wheel delta (it has
  to, being `deltaMode`-agnostic), so a combined delta would collapse to a
  single FOV step and cap the gain in observe mode.
- **The re-emitted event drops `ctrlKey`**, or the capture listener
  re-enters on its own output.
- **The two signals are mutually exclusive.** `gestureActive` (set between
  `gesturestart` and `gestureend`) stands the wheel path down, so a browser
  reporting both can't count one gesture twice. The wheel is still
  `preventDefault`ed while standing down — page zoom has to stay suppressed
  either way.

`scaleStepDeltaPx` converts a step of WebKit's cumulative `scale` into the
wheel-pixel delta the Blink path speaks (logarithmically, so equal ratios
are equal deltas at any zoom). The two knobs that fall out:
`PINCH_NOTCH_GAIN` scales **both** paths, `PINCH_SCALE_DELTA_PX` scales
**WebKit only** — set the cross-browser balance with the second, then move
the first for overall feel. Both are linear, and neither is pinned to a
value by a test.

**Touch needs none of this** — TrackballControls' native two-finger
`TOUCH_ZOOM_PAN` drives the same zoom, which is why pinch works on iPhone
with no app code. `noPan` leaves its pan half inert, so two-finger touch
is zoom-only.
