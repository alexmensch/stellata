# Camera

Camera controllers + shared coordination. Each subsystem owns a
subfolder; `timing.ts` carries the canonical durations / floors used
across all five.

## Subsystems

- `controls/` — TrackballControls subclass, mode-toggle pill, the
  pointer input controller (click FSM + gesture roll), click / hover
  picker, aim slerps, `camera.up` re-anchor, and the angular
  star-geometry / star-physics helpers. The "steady-state geometry +
  cross-mode plumbing" layer.
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
focusable body**: Mimas parks only ~4.7× above `CAMERA_NEAR_PC` at
`FOV_MAX_DEG`. A moon ~4× smaller, or a wider `FOV_MAX_DEG`, puts a
focused body on the clip plane where it vanishes at max zoom. That
margin is thinner than the `1e-12` value suggests — check the test
before moving either constant.

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
