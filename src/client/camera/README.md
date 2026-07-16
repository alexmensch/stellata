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

## Shared

`timing.ts` is the single source of truth for camera-wide constants:
`CAMERA_LERP_MS`, `WARP_*_MS`, `AIM_*_MS`, `OBSERVE_TRANSITION_MS`,
`DCAM_LOG_FLOOR_PC`, `WARP_BASE_DIR`. Imported by every subsystem so
phase boundaries stay aligned across controllers.

The constants live in their own module specifically to break the
import cycle between `stellata.ts` (the warp state machine + camera-
lerp consumer) and `warp/warp-tuning.ts` (the debug-panel surface that
exposes them as live-tunable knobs). When the constants lived on
`stellata.ts`, `warp-tuning.ts`'s top-level `const knobs = { ... }`
initializer ran before stellata's `export const WARP_REORIENT_MS = ...`
line was evaluated, leaving the values in the temporal dead zone at
module-load time — the catalogue (and the rest of the app) never got
to boot. New camera / lerp / numeric-floor knobs land here.

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
