# Camera

Camera controllers + shared coordination. Each subsystem owns a
subfolder; `timing.ts` carries the canonical durations / floors used
across all five.

## Subsystems

- `controls/` — TrackballControls subclass, mode-toggle pill, click /
  hover picker, aim slerps, `camera.up` re-anchor, and the angular
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
