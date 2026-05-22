# Focus FSM

What it means to "focus" an object. The focus state, the kind-agnostic
`FocusTarget` interface that lets the camera and overlays talk about
stars, clouds, and any future focusable kind through one contract, the
focus-park lerp, and the `uPinFocusToCenter` shader pin that keeps a
close-approach focused star sitting at exactly NDC origin.

## Files

- `focus-controller.ts` (+ test) — the FSM. Owns `focusedStar`,
  `focusedCloud`, `focusedPlanetSystem`, the focus-park lerp state,
  pin-engage geometry, and the `makeStarFocusTarget` /
  `makeCloudFocusTarget` / `currentFocusTarget` factories. Canonical
  home for `GLOBAL_MIN_DIST_PC` + `PIN_ENGAGE_THRESHOLD_SQ_PC`.
  Implements the `FocusOps` interface consumed by `WarpController` and
  the `ObserveFocusOps` interface consumed by `ObserveTransition`.
- `focus-target.ts` — the `FocusTarget` contract. Per-kind factories
  return objects closing over the current focus state + controller
  deps so warp / overlays / arrival math can read positions and
  emit events without knowing the kind.
- `focus-transition.ts` (+ test) — `tickFocusLerp` + the generic
  `parkDistance(...)` + `newFocusLerpFrom(...)` primitives. Star-,
  cloud-, and future-focusable-park-arrivals all compose these. The
  per-frame motion delegates to `../arrival/camera-motion.ts`.

`FrameAnchor` (recenterOrigin / worldOffset / starLocalPosition)
stays on `stellata.ts` — those primitives rewrite the star-pipeline
`_localPositions` buffer alongside the ShaderMaterial it feeds.

## Focus state

- `focusedStar`, `focusedCloud`, `focusedPlanetSystem`,
  `planetSystemToken`. **Mutually exclusive** (star ↔ cloud); the
  second setter clears the first via the standard `setFocus(null)` /
  `setFocusedCloud(null)` paths so a single event ordering rule
  (`'cloudFocus'` before `'focus'`) covers every swap.
- Click/select-driven entry points: `focusStar`, `setOrbitTarget`,
  `flyToCloud`, `setOrbitTargetCloud`, `unfocus`. Each gates on
  `getWarp().isActive()` and cancels any in-flight focus-park /
  unfocus lerp before claiming the camera.

Construction cycle: `WarpController` and `ObserveTransition` both take
`focus: FocusOps` from `FocusController`, but `FocusController`'s
guards read back into those controllers (`getWarp().isActive()` etc.).
The cycle is broken by `getWarp: () => this.warp` and
`getObserve: () => this.observe` lazy refs: FocusController is
constructed first (with neither dep wired), Warp + Observe are
constructed next (with `focus: this.focus`), and the lazy getters
resolve at first request. Same pattern Picker uses for async-attached
layers (`getClouds`, `getLocalGroup`).

Bus events emitted from the controller:
- `'focus'` (number | null), `'cloudFocus'` (number | null),
  `'planetSystem'` (PlanetSystem | null) — focus state mutations.
- `'focusLerp'` (boolean) — focus-park lerp start / end edges.
- `'cameraMode'` (CameraMode) — from `setFocus`'s observe-cleanup
  branch (focal star changing while in observe mode).
- `'state'` — at every focus mutation + focus-lerp edges.

## FocusTarget contract

Warp, focus-park lerp, mid-Fly recentre, and any future
camera-transition code consume focusable objects through the
**`FocusTarget` interface** (`focus-target.ts`). Adding a new
focusable kind (planet, probe, nebula, exoplanet, …) consists of:

1. Implementing the interface (typically as a factory method on
   `FocusController` that returns an object closing over the per-kind
   catalog / state / event-bus references).
2. Plumbing pick / click handling for the new kind so its
   `FocusTarget` can be passed to `startWarp` / `focusStar`-style
   entry points.

That's it. The warp internals (`updateWarp`, `finishWarp`, mid-Fly
recentre, pin guard, scale-bar focus tracking, …) stay agnostic above
this seam and do not need to change.

### The interface

```ts
interface FocusTarget {
  readonly kind: 'star' | 'cloud';   // extend the union per new kind
  readonly idx: number;
  anchorInto(out: Vector3): boolean;        // absolute-space anchor
  localPositionInto(out: Vector3): boolean; // current floating-frame position
  parkRadius(): number;                     // camera-to-anchor at parked pose
  applyFocus(): void;                       // per-kind state mutation, no events
  emitFocusEvents(): void;                  // deferred event family fire
  physicalRadius(): number | null;          // geometric radius (pc) or null when undefined
  chartPlateauDistance(magBright: number): number | null;  // chart-mode disc plateau distance
}
```

| Method | Role |
|---|---|
| `anchorInto` | Input to `recenterOrigin`. The floating origin lands here when the object is focused. |
| `localPositionInto` | Per-frame `camera.lookAt(...)` source during warp Fly. Also used by overlays that project the object's position, and as the warp's source-`A` derivation in `warpTo` / `warpToCloud`. |
| `parkRadius` | The warp computes `pStart` / `pEnd` as `anchor − travelDir · parkRadius()` for source and destination respectively — symmetric across both endpoints. |
| `applyFocus` | Sets the per-kind `focusedStar` / `focusedCloud` / etc. field, updates derived state (`minDistance`, planet system attach), clears whichever sibling-kind focus was set. **No events fire.** |
| `emitFocusEvents` | Fires the deferred event family — typically `'focus'` / `'cloudFocus'` (plus a sibling-clearing `null` emit when the previously-focused object was a different kind), then `'state'`. Called from `finishWarp` after the camera lands. |
| `physicalRadius` | Geometric radius in parsecs, or `null` when the kind has no single radius (clouds — ellipsoid axes don't reduce to one). Consumed by arrival curves that need angular size — the hybrid curve's inner regime uses `θ = R/d` for the close-approach smoothstep. Kinds returning `null` silently fall back to a log-d profile. |
| `chartPlateauDistance` | Camera-to-anchor distance at which the chart-mode disc plateaus at `uChartDiscMaxPx`, given the current `uChartMagBright` threshold. Returns `null` when the chart-mode treatment isn't a magnitude-driven disc (clouds → isobar contour). Used by `updateWarp` to pivot Fly → phase 3 early when chart mode is active and the destination disc would stop growing perceptibly. |

The applyFocus/emitFocusEvents split is what lets the warp's mid-Fly
recentre mutate focus state at the trajectory midpoint without firing
UI-visible events ~half a warp duration before the camera actually
arrives — events settle in lock-step with the landing.

### How the warp consumes it

`WarpState` carries `source: FocusTarget` and `dest: FocusTarget`. The
warp animation reads geometry via the interface methods and mutates
focus state via `dest.applyFocus()` (mid-Fly recentre) and
`dest.emitFocusEvents()` (`finishWarp`). No `destKind` switches remain
in the warp pipeline; the dispatch table sits in the
`makeStarFocusTarget` / `makeCloudFocusTarget` factory methods on
`FocusController`, which is the one place that needs editing when a
new kind is added.

## Focus-park lerp

Click-focus on a star (or `flyToCloud` for clouds) doesn't teleport.
The lerp lives here as the generic `parkDistance(...)` +
`newFocusLerpFrom(...)` + `tickFocusLerp(...)` trio — stars consume it,
clouds compose the same primitives, future focusable kinds plug in the
same way.

Branch in `focusStar` / `flyToCloud`:

- **`eyeDist <= parkDist` → stay put.** Camera doesn't move; only
  `controls.target`, `controls.minDistance`, and focus state update.
- **`eyeDist > parkDist` → lerp.** Camera position lerps from
  `fromPos` to `toPos = target + (eye-direction × parkDist)` and
  camera orientation slerps in parallel from `fromQuat` to a
  quaternion that looks at the target from `toPos`. Both
  interpolations are driven by the same smoothstep, so the camera
  continuously rotates toward the new target as it flies in. Builds
  the lerp **after** `setFocus` recentres the floating origin so
  `fromPos` / `toPos` live in the post-recentre frame.
- **`opts.animate === false`** (URL restore) bypasses the lerp and
  snaps to the park pose.

`controls.enabled` is **not** toggled during the lerp — the
`animate()` dispatcher routes through `updateFocusLerp` before
`controls.update()`, so user drag accumulates inside
`TrackballControls` without visible effect until the lerp lands.
Disabling explicitly would race `TrackballControls`' pointerup
handler. Same precedent as the unfocus lerp
(`../observe/README.md`).

The focus-star pin (`uPinFocusToCenter`) is suppressed while the
lerp is in flight — `controls.target` is already `(0,0,0)` in the
post-recentre frame, so the pin would otherwise snap the focal star
to NDC origin while the camera is mid-rotation, making the star
appear pasted at screen centre instead of following the rotation
naturally.

`#overlay` (HUD arrows + ring, focus ring, distance vector,
constellation lines, POI labels, etc.) is hidden for the lerp's
duration via a `body.focus-lerping` class — same mechanism the warp
uses (`body.warping`). Stellata fires the `'focusLerp'` event on
start / end edges; `main.ts` toggles the body class.

`cancelFocusLerp` is wired at every site that already calls
`cancelUnfocusLerp` (`focusStar`, `flyToCloud`, `unfocus`,
`startWarp`, `aimAt`, `aimAtConstellation`, `onPointerUp`) so a
follow-up camera-changing action can't race the in-flight lerp.

The per-frame motion (camera position + orientation) delegates to
`../arrival/camera-motion.ts:tickArrival` so focus-park, warp Fly,
and unfocus all share one arrival profile.

## Pin-to-center (`uPinFocusToCenter`)

After the physical-orbit floor (`R / tan(0.45·fovMinor)` for a
Sol-class star) brings the camera to ~5e-8 pc on close approach,
float32 cancellation in the projection chain
(`projectionMatrix * modelViewMatrix * vec4(0)`) drifts the projected
centre by visible pixels even though the focused star is
mathematically at view-origin. Float64 emulation was rejected as too
heavy; instead `star.vert.glsl` exposes a `uPinFocusToCenter: int`
uniform (-1 = disabled). When set, the shader replaces the projection
chain with `projectionMatrix * vec4(0, 0, -dPc, 1)` for the matched
`gl_InstanceID` — bypassing matrix-multiply cancellation entirely.
One int uniform, ~5 lines of GLSL, no CPU cost.

JS-side per frame in `stellata.ts`: pin engages iff
`FocusController.isPinEngaged()`, which checks
`focusedStar !== null && cameraMode === 'navigate'
&& (!warp.isActive() || warp.isRecenteredToDest())
&& !aim.isActive() && !focusLerpState
&& controls.target.lengthSq() < 1e-12`.

The `warp.isRecenteredToDest()` clause relaxes the pin guard for the
post-recentre window of warp Fly: after the mid-Fly recentre the
destination is at local `(0,0,0)` and the camera is doing
`lookAt(local origin)` per frame, so pin-to-NDC matches the geometry
`lookAt` is already computing. The shader pin then bypasses any
residual Float32 noise in the projection chain through to
`finishWarp`. The `focusLerpState` clause stays unconditional —
focus-park slerps the camera quaternion through an arc that's not
continuously aimed at the focal star, so pinning would snap-jump it
to NDC origin before the slerp finishes rotating into it.

**Load-bearing invariant:** `controls.target` must be `(0,0,0)`
*exactly* (length < 1e-6 pc). Any code path that engages focus while
leaving target at a non-trivial residual silently disengages the
pin. Three residual sources have bitten this:

1. **Sol's catalog offset.** Sol is at AT-HYG `(5e-6, 0, 0)` pc, not
   `(0,0,0)`. `recenterOrigin(solPos)` shifts target by `5e-6` →
   guard fails on first frame.
2. **Float32 truncation on long warps.** `finishWarp`/`focusStar`
   read target from `_localPositions` (Float32Array), then
   `recenterOrigin` shifts target by a delta computed fresh in
   float64. The two representations of `|AB|` differ by Float32 ULP
   (~`|AB|·1e-7`); for Sol→Rigel (265 pc) that's `~5e-5 pc`,
   comparable to Rigel's arrival endOffset → 30 %-of-screen drift.
3. **Unfocus from close approach.** Solved by removing the
   `recenterOrigin(0,0,0)` from the `setFocus(null)` branch
   (`worldOffset` stays put on unfocus).

**Fix for #1 and #2** lives at the choke point in
`FocusController.setFocus`'s `idx !== null` branch: after
`recenterOrigin`, subtract `target` from `camera.position`
(preserving cam-to-target offset) and snap target to `(0,0,0)`.
Eliminates both residuals for every caller of `setFocus`.

Limitations: pan moves target away → pin disengages (intentional;
post-pan the focused star isn't at view centre). Doesn't fire in
observe mode or during aim animations. Pin DOES fire during the
post-recentre window of warp Fly; pre-recentre Fly stays guarded
because the focused star is the source, not the destination the
camera is flying toward.

**Where to look:**
- `../../star-pipeline/star.vert.glsl` — `uPinFocusToCenter` decl + use site.
- `focus-controller.ts` — `GLOBAL_MIN_DIST_PC = 5e-3`,
  `PIN_ENGAGE_THRESHOLD_SQ_PC = 1e-12`, `setFocus` body, `isPinEngaged`
  gating rules.
- `../../stellata.ts` — per-frame pin guard in the animate loop
  (reads `focus.isPinEngaged()` + `focus.getFocusedStar()`).
- `../../util/url-state/url-state.ts` — `DecodedView.worldOffset`,
  encoder/loader.
- `../../debug/pin-debug-hud.ts` — Pin section in the unified debug
  panel (`debug.panel()`); live readouts with latched directional
  extremes. **Always use this when investigating any "star drifts
  off-screen" report.**
