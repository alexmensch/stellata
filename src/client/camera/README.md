# Camera

Camera controllers + shared coordination. Each subsystem owns a
subfolder; `timing.ts` carries the canonical durations / floors used
across all five.

## Subsystems

- `controls/` — mode-toggle pill, click / hover picker, aim slerps, and
  the angular star-geometry / star-physics helpers. The "steady-state
  geometry + cross-mode plumbing" layer. Its `input/` subfolder owns
  every canvas gesture: click FSM, roll (reference up axis +
  galactic-north lock), pinch-to-zoom, and TrackballControls' tuning.
- `focus/` — focus FSM (`focus-controller` + `focus-target` +
  focus-park lerp) and the `uPinFocusToCenter` shader-pin contract.
  What it means to "focus" an object; how warp and overlays read
  per-kind focus state through the `FocusTarget` interface.
- `warp/` — 3-phase warp FSM and the warp-button click handler.
  Travel from A → B.
- `observe/` — OBSERVE mode look-around controller + the
  navigate↔observe transition FSM.
- `arrival/` — log-distance smoothstep math shared by focus-park, warp
  Fly, and unfocus. Pure helpers + the per-frame `tickArrival` driver.

`camera-config.ts` and `timing.ts` sit at this level — see § Shared.

## Shared

`timing.ts` is the single source of truth for camera-wide constants:
`CAMERA_LERP_MS`, `WARP_*_MS`, `AIM_*_MS`, `OBSERVE_TRANSITION_MS`,
`FOV_MIN_DEG` / `FOV_MAX_DEG`, `CAMERA_NEAR_PC`, `DCAM_LOG_FLOOR_PC`,
`WARP_BASE_DIR`. Imported by every subsystem so phase boundaries stay
aligned across controllers.

`depth-range.test.ts` pins the near/far configuration — a numeric
invariant no formula enforces. The binding constraint is the **smallest
focusable body**: Mimas parks only ~6.7× above `CAMERA_NEAR_PC` at
`FOV_MAX_DEG`, where the floor is the `ORBIT_FLOOR_SURFACE_MARGIN`
clamp rather than the fill solve (`controls/README.md` § Manual-zoom
floor). A moon ~6× smaller, or dropping that clamp, puts a focused body
on the clip plane where it vanishes at max zoom. Widening `FOV_MAX_DEG`
no longer thins the margin — the clamp is FOV-invariant. That margin is
thinner than the `1e-12` value suggests — check the test before moving
either constant.

The near plane also **decides** one focus kind's park outright rather
than merely bounding it: a probe has no disc to solve against, so its
fixed park / floor pair is chosen for near-plane margin
(`controls/README.md` § star-physics). Any future fixed-pixel focusable
lands in the same regime.

The constants live in their own module specifically to break the
import cycle between `stellata.ts` (the warp state machine + camera-
lerp consumer) and the modules that read them at animation start.
When the constants lived on `stellata.ts`, a top-level
`const knobs = { ... }` initializer ran before stellata's
`export const WARP_REORIENT_MS = ...` line was evaluated, leaving the
values in the temporal dead zone at module-load time — the catalogue
(and the rest of the app) never got to boot. New camera / lerp /
numeric-floor constants land here.

### Shipping config vs debug panel

`camera-config.ts` holds the live camera-motion config — durations,
the arrival seam multiplier, the mid-Fly recentre fraction — seeded
from `timing.ts`. Production controllers read it through
`cameraConfig()` / `arrivalEaseFn(ctx)`; `warp/warp-tuning.ts` (the
debug panel) writes into it through `setCameraConfig`. The direction
is load-bearing: a shipped camera path must never import a debug
module, and a build that never opens the panel behaves exactly as the
`timing.ts` constants describe.

Reads happen once per animation — at `startWarp`, at the focus-park /
unfocus entry points, inside `tryMidFlyRecentre`. Never cache a config
value module-side: a slider edit has to reach the next warp, and an
in-flight one must keep the values it launched with.

Values that stopped being tuned graduate out of the config into a
`const` beside their consumer (`CHART_PLATEAU_MARGIN` and
`CHART_PHASE3_ALPHA` in `warp/warp-controller.ts`) — a slider whose
value has settled is complexity without payoff.

### Test stubs

`camera-test-stubs.ts` carries the `TrackballControls` /
`ObserveControls` / `AimController` doubles every controller suite
needs. Each stub holds the union of the fields the five controllers
touch, so a suite that starts asserting on a new field extends the
shared builder rather than forking a local copy. Per-controller
harnesses (deps assembly, `FocusOps` fixtures) stay in their own test
file — they mirror real coupling and don't generalise.

## Cross-controller seams

- `FocusOps` interface — `focus/focus-controller.ts` exposes this to
  `WarpController`, which calls it for focused-star reads, focus-park
  geometry, and vector-slot clears.
- `ObserveFocusOps` interface — `focus/focus-controller.ts` exposes
  this to `observe-transition.ts`, which calls it during the
  navigate↔observe swap.
- `tickArrival` — `arrival/camera-motion.ts` is consumed by
  `focus/focus-transition.ts` (focus-park lerp),
  `warp/warp-controller.ts` (warp Fly phase), and
  `observe/observe-transition.ts` (close-zoom unfocus).

## Camera-activity predicates

Roll state is deliberately absent from this table: the reference-up
correction runs on every navigate frame regardless of which animation
owns the camera, because it only writes `camera.up` and a captured
slerp endpoint already agrees with it (`controls/input/README.md`
§ Reference up axis).

Five overlapping "is the camera doing something" predicates exist, and
picking the wrong one is the standing risk every new camera feature
runs. There are **four independent animation sources** — warp, aim
slerp, focus-park lerp, and the `ObserveTransition` slot (which itself
carries three kinds: `enter` / `exit` / `unfocus`, see
`observe/README.md` § ObserveTransition kinds). Each predicate is a
different subset:

| Predicate | Warp | Aim | Focus-park lerp | Observe `enter`/`exit` | Observe `unfocus` |
|---|:-:|:-:|:-:|:-:|:-:|
| `ObserveTransition.isActive` | – | – | – | ✓ | – |
| `ObserveTransition.isAnyActive` | – | – | – | ✓ | ✓ |
| `AimController.isActive` | – | ✓ | – | – | – |
| `Stellata.isCameraTransitionActive` | ✓ | – | – | ✓ | ✓ |
| `FocusController.isCameraBusy` | ✓ | ✓ | ✓ | ✓ | ✓ |

Why each one exists, and who reads it:

- **`isCameraBusy`** — the full union; the only "camera is animating at
  all" gate. Read by `ObserveTransition.setMode` (through
  `ObserveFocusOps`) before it claims the camera.
- **`isCameraTransitionActive`** — warp + every observe kind, but
  **not** aim or focus-park. It gates *position* serialisation: the
  `url-state` frame-hash writer skips writes while a camera
  **translation** is in flight so a transient mid-lerp pose is never
  written to `?v=`. Aim and focus-park are excluded because both settle
  on a pose the writer should capture.
- **`isAnyActive` vs `isActive`** on `ObserveTransition` — the union vs
  the observe-`enter`/`exit`-only pair. Anything gating on *observe-mode
  visibility* (`poi-overlay`, `setVectorSlot`, `warp-controller`) reads
  `isActive`: the `unfocus` kind is a navigate-mode lerp borrowing the
  same state slot, so including it would blank observe-gated UI during
  an ordinary close-zoom unfocus.
- **`AimController.isActive`** — the aim slerp alone; a focus change may
  interrupt an aim but not a warp.

### Camera mode: read on `focus`, write on `observe`

`stellata.focus.getCameraMode()` reads it; `stellata.observe.setMode()`
writes it. The asymmetry is deliberate and load-bearing —
`FocusController` owns the field (~20 unrelated read sites) while
`ObserveTransition` owns the enter/exit FSM and writes through the
`setCameraModeValue` dep callback, so it stays the only mode-switcher
(`observe/README.md` § ObserveTransition kinds). Callers pair the two
namespaces in one expression routinely; that is correct, not a smell.

### The claim-the-camera sequence

Three sites run the same four-step sequence when a *new user action*
wants the camera:

1. bail if warp or aim is animating (those own the camera outright),
2. `cancelUnfocusLerp()`,
3. `cancelFocusLerp()`,
4. bail if an observe transition is animating.

Sites: `controls/input/input-controller.ts` `onPointerUp`, `Stellata.aimAt`,
and `Stellata.aimAtConstellation` (steps 2–4 only — it has no
warp/aim bail).

**The step order is load-bearing.** Steps 2–3 sit *between* the two
bails, so the sequence cannot collapse into a single predicate call:
the focus-park and unfocus lerps are **cancelled** by the incoming
action, not blocked by it. A gate that folded them in — i.e.
`isCameraBusy()` — would make every click self-block whenever a
focus-park lerp happened to be in flight.

Consolidating this sequence behind one entry point is the job of the
intent-API seam (`focusOn` / `warpTo` / `observeFrom` / `aimAt`), not
of the individual call sites; it is deliberately left duplicated until
that seam lands.

### Verdict per input-controller gate

`InputController` re-checks the volatile gates twice — once at
`onPointerUp`, once when a deferred click fires `DBL_CLICK_MS` later:

| Site | Shape | Verdict |
|---|---|---|
| `onPointerUp` | steps 1–4 above | **narrower, deliberate** — the interleaved cancels are the whole point |
| `dispatchSingleClick` | `blocksClick()` | 3-term; focus-park already cancelled at pointer-up |
| `dispatchDoubleClick` | `blocksClick()` | same 3 terms — shares the one predicate |

**No site is strict-equivalent to `isCameraBusy()`.** Every one is
narrower on two axes at once: it excludes the focus-park lerp (which
the click cancels) and excludes the observe `unfocus` kind (a
navigate-mode lerp a click should be free to interrupt). `blocksClick()`
is therefore a pure de-duplication of the two deferred-dispatch gates,
not a widening — the deliberate narrowness is the reason the shared
helper is local to `InputController` rather than a `Stellata` method.
