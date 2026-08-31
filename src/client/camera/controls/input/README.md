# Camera input

Canvas gestures and the camera state they drive: the click FSM, the two
roll authorities and the gestures that write them, and pinch-to-zoom. TrackballControls' own tuning lives here too — the
gestures below toggle its `noRotate` / `noPan` flags.

## Files

- `input-controller.ts` (+ test) — every canvas pointer / touch / gesture
  listener: the click FSM (single/double dispatch in both modes, the
  kind-generic click ladder, cloud click semantics), the roll gestures,
  and the pinch normaliser.
- `roll-controller.ts` (+ test) — `RollController`: the roll operations
  on `camera.up` and on the quaternion, one authority per camera mode.
  Holds no state of its own beyond scratch. § Roll authority.
- `roll-pure.ts` (+ test) — roll algebra: level-up projection, signed
  roll angles, and camera-local up.
- `pinch-zoom-pure.ts` (+ test) — pinch-delta → wheel-notch normalisation
  (`PINCH_NOTCH_GAIN`, `pinchStep`).
- `trackball-settle.ts` (+ test) — `TrackballSettle`: stops the damping
  tail once a frame moves less than a tenth of a pixel. § Damping settle
  floor.
- `trackball-settle-pure.ts` (+ test) — the on-screen motion of one
  frame's step (`eyeSwingRad`, `trackballMotionPx`) and the floors
  themselves (`TRACKBALL_SETTLE_PX`, `ORIENTATION_SETTLE_ULP`,
  `POSITION_SETTLE_ULP`). § Derived-pose settle floor.

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
state. Roll math delegates to `RollController`, which owns the
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
would settle differently at Sol and at the LMC (AGENTS.md
§ Camera-anywhere). It is the navigate-mode sibling of observe's
`MOMENTUM_MIN_SPEED` (`../../observe/observe-controls.ts`), which has
floored its own momentum on the same argument from the start.

## Derived-pose settle floor

The damping floor above stops a tail that *decays*. This one stops a drift
that never decays at all, and the two must not be confused —
`../../../render-gate/README.md` § Pose change draws the distinction in
ULP, which is the only readout that separates them.

`TrackballControls.update()` rebuilds the pose from scratch every call: it
takes `eye = position − target`, writes `position = target + eye` back, and
re-derives the orientation with `lookAt(target)`. Both round-trips are
identities in exact arithmetic and **neither is exact in float64** once a
focal ride has translated camera and target together — `(t+d) − (p+d)`
does not round to `t − p`. So the derived pose lands a few representable
steps from the pose the ride wrote, every frame, forever. The render gate
compares by exact equality and read that as a camera move: with a moving
focus and the clock running, the gate woke on 28–55 % of ticks and the
clock cadence never idled.

`TrackballSettle.capture()` snapshots the pose immediately before
`update()`; `tick()` restores any component that came back inside its
floor. Restoring the *bits* is what makes the camera its own anchor — a
sub-floor step is not forgiven afresh against a reference that already
absorbed the last one.

**Two floors, because a ULP means different things per slot.** The
orientation floor is `ORIENTATION_SETTLE_ULP = 4096`: a quaternion is
unit-norm, so its ULP maps to an angle the same way at every vantage.
Position gets a much tighter `POSITION_SETTLE_ULP = 16`, because a
position ULP has no fixed angular meaning — far from the local origin but
close to the target, a wide floor would be a visible fraction of the eye
vector. Both are sized off a measured ride walk across 1e-6 pc to 1e4 pc
(orientation drifts 7–9 ULP, position 0–1), and the smallest rotation a
viewer can ask for — one hundredth of a pixel — is 4.6e18 ULP, so nothing
an input can produce falls inside either.

The OBSERVE half of the same defect is not floored but removed: its look
pin is re-derived only on rotation (`../../observe/README.md`
§ The serialised look pin).

## Roll authority

**`camera.up` is the roll state in NAVIGATE; the quaternion is the roll
state in OBSERVE.** Neither is derived from anything else, and there is no
third vector behind them.

- **NAVIGATE** — nothing runs on a steady-state frame. TrackballControls
  rotates `camera.up` by the same quaternion it rotates `_eye` by, then
  `lookAt` reads it, so the roll the user is holding is carried forward frame
  to frame by the library itself. While an **animation** owns the camera
  instead, nothing transports `up` — so `stellata.ts` re-derives it per
  animating frame; § The perpendicular invariant.
- **OBSERVE** — `adoptFromCamera(camera)` each frame, ahead of the
  animation dispatch in `stellata.ts`'s `animate()`: there the quaternion
  is the authority (a direct-manipulation drag rolls by construction), so
  `camera.up` follows it. That makes the observe→navigate handover a
  no-op — the first navigate `lookAt` reproduces the pose the drag left.

### The perpendicular invariant

`camera.up` is kept **perpendicular to the view axis**. `levelTo` and
`adoptFromCamera` both establish that, and TrackballControls preserves the
angle between `up` and `_eye` thereafter, so the image-plane projection
every `lookAt` and roll measurement depends on stays well-conditioned from
any vantage — there is no cone around any axis where it degenerates.

**TrackballControls is not the only thing that moves the camera, and the
others do not transport `up`.** A navigate aim slerp and a navigate warp
both disable the controls and drive orientation with `camera.lookAt()` per
frame while `camera.up` sits frozen, so the view axis sweeps and the angle
between the two closes by however far the sweep went. Aim at a point 8° short
of screen-up and `up` lands 8° off perpendicular; aim at screen-up exactly and
it lands *on* the boresight, where the projection is a zero vector and
three.js's `lookAt` falls back to an arbitrary roll. Neither self-repairs —
TrackballControls preserves whatever angle it inherits, so the view stays
ill-conditioned until the next `L`.

So the animate loop re-derives `up` on every frame a navigate animation owns
the camera. That is discrete parallel transport — project the rendered up
into the next image plane — which is what a drag does, so an aim now injects
no roll of its own instead of spinning the image as its endpoint approaches
the old screen-up. It does not reintroduce the 2-cycle below: that needs a
frame where nothing else moves, and these frames are moving by definition.
`camera/README.md` § Camera-activity predicates carries which branches count.

### Orbit drift is the feature, not the bug

Orbit drift is **parallel-transport holonomy**: a single TrackballControls
rotate step injects zero roll of its own, but any closed drag loop returns
with a net roll equal to the enclosed solid angle. A measured 4-lap circuit
comes back within 0.07 rad of its starting view direction carrying 0.38 rad
of roll — five times the path's own closure error, which is what
identifies the residual as holonomy rather than an unclosed loop
(`roll-controller.test.ts`).

That roll now **stands**. The camera is free to end up rolled after a long
orbit, because the attitude indicator says which way you are pointing
(`../../../attitude/README.md`) and `L` puts you back. Before it existed,
nothing on screen carried orientation, so a per-frame correction re-derived
`camera.up` from a persistent reference axis every navigate frame and held
the view galactic-level whatever the user did.

Two things went with that correction, and neither should come back:

- **A cone around the reference axis** where the projection was
  ill-conditioned and correction strength had to ease to zero, since "north
  stays up" flips through 180° over arbitrarily small travel across a pole.
  Nothing is re-derived now, so nothing is ill-conditioned.
- **A deadband on the correction's own write.** Correcting every frame had
  no fixed point: at level it measured a residual of order 1e-18 rad,
  applied it, and the project / normalise / rotate / normalise chain landed
  one representable step away, forever. `camera.up` moved on 200 of 200
  frames, alternating between two adjacent doubles, and since every
  navigate orientation source is a `lookAt` reading it, that reached
  `camera.quaternion` — which the render gate snapshots by **exact
  equality**, so the view could never idle with nothing moving on screen
  (`../../../render-gate/README.md`).

**The rule that replaces the deadband: steady-state navigate writes
`camera.up` on no frame of its own.** Only a gesture, a level, a URL restore,
a frame an animation owns (§ The perpendicular invariant), the landing
of a captured-endpoint animation, or the attitude indicator's **orbit lock**
writes it. That last one is per-frame and is admissible for the reason a
gesture is: it writes only on a frame where the orbit datum it rides moved far
enough for the write to show, so a paused clock writes nothing, a live-1× drift
accumulates instead of writing every frame, and the gate still idles
(`../../../attitude/orbit-frame/README.md` § The lock). `up → lookAt → quaternion → up`
is a rounding round-trip that 2-cycles exactly as the old correction did,
so `adoptFromCamera` must stay out of the navigate steady state — it is an
observe-mode and seam call only. `roll-controller.test.ts` pins a settled
navigate pose bit-identical across 200 `lookAt`s.

### Captured-endpoint animations

Camera animations split into two classes, and only one needs care:

| class | orientation source | sites |
|---|---|---|
| **A** | per-frame `lookAt`, reads `camera.up` | TrackballControls steady state, warp reorient (navigate launch), warp Fly, warp finish (navigate), the navigate aim tick (its `q0`/`q1` slerp drives *position*), observe exit's no-op `lookAt` |
| **B** | a quaternion captured up-front, then slerped | focus-park lerp `qEnd`, warp reorient (observe launch), warp phase 3, observe aim `q1` |

Class A inherits the authority for free — it reads `camera.up`, so the roll
comes along. What it does not inherit is the perpendicular invariant, which
the per-animating-frame adopt supplies (§ The perpendicular invariant).
**A Class-B endpoint must be built
from the same `camera.up` the camera is actually holding**, and the
animation must **re-derive `camera.up` from the landed quaternion** before
handing back. Build the endpoint from any other axis and the first `lookAt`
after landing resolves against a different up and rolls the view off the
pose the slerp settled on — `focus-transition.test.ts` pins both halves.

The adopt on landing is not a no-op even when the rendered pose already
matches: the launch `up` is perpendicular to the *launch* view axis, and
the end pose looks down a different one. Adopting is what puts it back on
the perpendicular invariant.

The observe-mode Class-B sites need no extra call — the per-frame adopt
already does it.

## Roll gestures

Three input paths, one dispatch (`InputController.rollCamera`): NAVIGATE
turns `camera.up` about the view axis, OBSERVE rolls the quaternion. The
image rolls by exactly the angle asked for either way — a `lookAt` renders
up's component perpendicular to forward, and turning about forward turns
that component by the same angle. Both leave the tilt persistent through
subsequent orbit / dolly.

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
rotating the up CCW in world space makes content appear CW.

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
