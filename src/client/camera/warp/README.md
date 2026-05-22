# Warp animation

The animated camera flight between the focused star (A) and the
distance-vector destination (B). State machine, phase math, scale-bar
behaviour, and the navigate↔observe interactions on launch/arrival.
For the steady-state camera geometry (minDistance / TrackballControls)
see `src/client/camera/controls/README.md`; for OBSERVE mode see
`src/client/camera/observe/README.md`.

The 3-phase FSM, `WarpState`, the `startWarp` / `finishWarp` /
`updateWarp` / `tryMidFlyRecentre` / `swapObserveAnchor` methods, plus
the warp-only scratch state all live in `src/client/camera/warp-controller.ts`.
The integration shell composes the controller alongside Picker /
AimController and delegates the animate-loop tick when
`warp.isActive()` returns true. Cross-controller coupling (focus
state, FocusTarget factories, floating-origin recentre, vector-slot
clear) lives behind the `FocusOps` interface implemented by
FocusController; the `focus:` dep wire updates
in one line.

## Files in this area

```
src/client/camera/
  warp-controller.ts              3-phase warp FSM (reorient → fly →
                                  post-arrival) + WarpState +
                                  tryMidFlyRecentre + swapObserveAnchor +
                                  FocusOps cross-controller seam.
  warp-pure.ts (+ test)           Pure phase math (slerp, ease, recentre
                                  predicate).
  warp-tuning.ts                  Tuning section in the debug panel.
  warp-button.ts                  Yellow distance label → warp trigger
                                  click handler + "→ Warp" hover suffix.
  focus-controller.ts             Focus FSM + focus-park lerp + per-kind
                                  FocusTarget factories + pin-engage
                                  geometry. FocusOps seam consumed by
                                  WarpController; ObserveFocusOps seam
                                  consumed by ObserveTransition. Canonical
                                  home for GLOBAL_MIN_DIST_PC +
                                  PIN_ENGAGE_THRESHOLD_SQ_PC.
  focus-target.ts                 FocusTarget contract (per-kind: star /
                                  cloud / planet / Local Group /
                                  heliopause). FrameAnchor
                                  (recenterOrigin + worldOffset +
                                  starLocalPosition) stays on stellata.ts.
  focus-transition.ts             tickFocusLerp — focus-park lerp via
                                  the shared camera-motion.ts arrival
                                  profile (see src/client/camera/arrival/README.md).
  (+ tests for each pure module.)
```

## Warp animation

An animated camera flight between the focused star (A) and the distance
vector destination (B). Trigger: click the yellow distance label on the
SVG overlay (hovering reveals a "→ Warp" suffix), or press `W`. Skip: the
muted ghost pill at top-center (shown only while warping), or `Esc` /
`Space`. Click-tip-to-travel routes through `focusStar(idx)` for
consistency with search-select (parks at `parkDistForStar(idx)` — same
auto-park every landing uses; lerps over `FOCUS_LERP_MS` or stays put
when already inside park, see `src/client/camera/observe/README.md` § Focus-park
lerp).

Two- or three-phase animation in `WarpController.updateWarp` (called
per frame via `WarpController.tick(nowMs)`), depending on whether the
warp re-enters OBSERVE on arrival:

1. **Reorient** (`WARP_REORIENT_MS` = 1800). Camera position
   spherically slerps around A from wherever the user was to `A +
   dirBack × sourceOffset` (on the travel line, offset behind A from
   B's perspective). Simultaneously the orbit distance eases linearly
   from `mag0` down to `sourceOffset`. End state: A is centered and B
   is straight ahead, beyond A. Quaternion slerp is used for the
   angular interp (robust against antipodal starting positions).
   `sourceOffset` is the source's own auto-park distance (see
   `src/client/camera/controls/README.md` § Camera near plane vs controls minDistance),
   separate from `endOffset` (the destination's). Decoupling these
   handles asymmetric warps cleanly: a Betelgeuse → Sol flight starts
   well outside Betelgeuse's giant disc and arrives at Sol's small park
   radius, with neither endpoint inside the other star.

   Camera orientation during the reorient depends on launch mode:
   - **Navigate launch:** `camera.lookAt(A)` is called every frame.
     With `mag0 > 0` this keeps A perfectly centered as the camera
     swings around it.
   - **Observe launch** (`returnToObserve`, `mag0 ≈ 0`): the
     lookAt-per-frame approach degenerates — the camera starts on top
     of A, so `lookAt(A)` snaps to "facing forward" the instant the
     position moves off A. Instead we slerp the camera quaternion from
     `startQuaternion` (the user's observe view direction) to a
     `reorientEndQuaternion` captured at warp start (= the orientation
     `lookAt(A)` would produce from `pStart`). This animates the user's
     view smoothly turning from wherever they were looking to "facing
     the destination" before the fly phase begins.

2. **Fly** (log-scaled duration, `WARP_T_MIN_MS` to `WARP_T_MAX_MS`).
   Camera position rides the line from `pStart` (= A + dirBack ×
   sourceOffset) to `pEnd` (= B − forward × endOffset), delegated to
   `camera-motion.ts`'s `tickArrival` so the Fly phase shares the
   shipped arrival profile with focus-park and unfocus. The profile is
   the **hybrid two-regime curve** — linear-d piecewise-quad outer
   (rocket-impulse, parallax-driven) → quintic smootherstep on
   angular-size inner (smooth perceptual landing on disc growth), with
   a single tunable seam-distance multiplier. See
   `src/client/camera/arrival/README.md` § Profile for the geometry and the
   panel-knob wiring. `camera.lookAt(B)` throughout.

   **Mid-Fly floating-origin recentre.** The moment the camera passes
   the trajectory midpoint (`|camera − B|² < ¼·|B − A|²` — the
   "source star is behind the camera" cue), `updateWarp` calls
   `tryMidFlyRecentre`, which shifts the floating origin onto the
   destination's absolute anchor and migrates the in-flight
   `WarpState` waypoints + `ArrivalState` cached vectors into the
   new frame via `shiftWarpWaypoints` + `shiftArrivalWaypoints`.
   After the shift, `dest.localPositionInto` returns ≈(0,0,0), so
   the per-frame `lookAt(B)` becomes `lookAt(local origin)` —
   geometrically equivalent, numerically clean.

   Why this exists: any log-d Fly profile (cubic-Hermite fallback for
   clouds + outbound, and the hybrid curve's inner regime on θ for
   stars) parks the camera inside `|B − camera| < ULP(|B|)` for some
   non-trivial window of long-range arrivals (e.g. Betelgeuse → Sol).
   In that zone `B − camera.position` loses all Float32 precision and
   the `lookAt` quaternion jitters across representable values, so
   the destination renders off-screen for several frames before
   `finishWarp` recentres and snaps it to NDC origin. Recentring
   mid-Fly eliminates the chaos zone entirely (stellata-2br.5). The
   issue was first surfaced under the cubic-Hermite log-d profile,
   which sat inside that zone for the last ~19 % of Fly; the hybrid
   curve's angular-size inner regime is geometrically cleaner but
   still terminates close enough to the destination that the same
   recentre is the right answer.

   Kind-agnostic via the `FocusTarget` contract — works for any
   focusable kind that implements `anchorInto` and `applyFocus`.
   `dest.applyFocus()` mutates focus state in place; the deferred
   event family is fired from `finishWarp` via
   `dest.emitFocusEvents()` so the search-row label and friends
   settle in lock-step with the camera landing rather than ~half a
   warp duration early.

   **Chart-mode plateau-trigger.** Chart mode renders stars as
   magnitude-driven discs (`pxSize = mix(maxPx, minPx, chartT)` with
   `chartT = clamp((appMag − magBright)/(maxAppMag − magBright), 0, 1)`
   — see `src/client/chart-mode/README.md` §Star disc sizing). Once the camera is
   close enough that `appMag ≤ uChartMagBright`, `chartT` floors to 0
   and the disc plateaus at `uChartDiscMaxPx`. Under both the hybrid
   inner regime and the cubic-Hermite fallback, the camera spends much
   longer in the close-approach window than under the legacy piecewise
   profile — so the user can sit for hundreds of milliseconds inside
   the plateau zone watching a disc that doesn't grow, with no
   perceptual progress signal. Pivot to phase 3 early instead: when
   chart mode is active (observe-only) at warp start, cache the
   plateau distance via
   `dest.chartPlateauDistance(uChartMagBright)` (`chart-disc-pure.ts`
   solves the distance-modulus identity for the threshold magnitude:
   `d = 10^((magBright − absMag + 5)/5)` pc — Sol's default plateau
   sits at ~0.43 pc, Betelgeuse's at ~58.9 pc). During Fly, once the
   camera is inside that radius AND mid-Fly recentre has fired, pin
   `state.pEnd` to the current camera position and shrink
   `state.durationMs` to the elapsed Fly time so the next frame falls
   into phase 3 with `flyEndQuaternion` captured from the live
   lookAt(dest) orientation. Phase 3's parallax slerp then carries
   the perceptual progress signal across the plateau zone (a flatlined
   disc + a rotating camera reads as motion). Gated on
   `recenteredToDest` so the dest-local position check is well-conditioned
   (target at (0,0,0), no ULP residual) and so the transition can't fire
   before the floating-origin shift cleans up the projection chain.
   Clouds return `null` from `chartPlateauDistance` — chart mode
   renders them as isobar contours rather than discs, no plateau to
   detect.

3. **Post-arrival reorient** (only when `returnToObserve`, duration =
   `OBSERVE_TRANSITION_MS` = 1800 ms). Quaternion slerps from the
   fly-end "looking at B" orientation back to the `startQuaternion`
   snapshot taken at warp start. The user sees the same celestial
   direction they were facing when they picked the destination, now
   from the new vantage — foreground stars shift via parallax, distant
   Milky Way stays roughly fixed.

   Camera position **also lerps from `pEnd` to `B`** across this
   phase, so the parallax view ends with the camera exactly at the
   destination star. Without this, `swapObserveAnchor` would absorb
   an `endOffset`-sized hidden teleport at `finishWarp` (its
   `set(0,0,0)` snap), leaving the user with the impression that the
   slerp happened from the wrong vantage. The destination disc stays
   visible across the entire post-arrival window — `swapObserveAnchor`
   pins `uHideFocusIdx` to the destination only at `finishWarp`, so
   the user sees the star they're arriving at right up until the
   camera parks inside it. Hiding it earlier would feel like the star
   pops out before the camera arrives.

   Skipped on navigate-mode arrivals because `TrackballControls.update()`
   calls `camera.lookAt(target=B)` every frame and would overwrite the
   slerped quaternion one frame after `finishWarp`, leaving the user
   with a hard snap-back. Observe arrivals preserve the slerp because
   controls are disabled and `observeUpdateTarget` reads
   `controls.target` from the camera quaternion, not the other way
   around.

   The floating origin is recentred onto B at the start of phase 3
   (not at `finishWarp`). Without this, both the camera and B sit at
   the same kpc-scale magnitude in the source-local frame for the
   1.2 s slerp window, and `matrixWorldInverse * B` loses float32
   precision — visible as the destination star jittering as the
   quaternion rotates (stellata-fqw). After the recentre B is at local
   `(0,0,0)` and the camera lerps in from a small offset; the
   projection chain stays clean. `uHideFocusIdx` still points at the
   source for the rest of phase 3 so the destination remains visible
   throughout the parallax slerp; `swapObserveAnchor` at `finishWarp`
   re-points it to the destination on landing. Mirrors the
   navigate-mode path (`setFocus(destIdx)` recentre at `finishWarp`),
   pulled forward by `postArrivalMs`.

Scale-bar smoothness: `controls.target` is pointed at **B** from the
moment the warp begins (not just at arrival). Camera orientation is
controlled independently via `camera.lookAt`, so the reorient phase can
still keep A centered visually while the horizontal scale bar (which
reads scene-scale at the camera-target depth) already reflects
distance-to-destination — this avoids a jarring scale-bar snap when the
target would otherwise switch from A to B at arrival.

The bottom-left widget's separate **focus z-axis indicator** (the
perspective recession line above the scale bar; see
`src/client/ui/README.md` §Bottom-left widget) follows a different
rule: during warp it shows the source star/cloud while the camera is
on the source side of the A→B axis, and flips to the destination once
`(camera − A) · (B − A) > 0`. Trajectory-relative test, not camera-
attitude — stays stable under future curved-warp paths. Implemented
via `Stellata.getWarpInfo()`.

During warp: `controls.enabled = false` (no orbit), pointer-up click
handling is short-circuited, URL writer skips frame-hash updates (camera
is changing every frame and we don't want to serialise intermediate
poses), and `body.warping` toggles a CSS class that hides the entire
SVG overlay (distance vector, figure, focus ring) since their per-frame
reprojection looks chaotic under fast travel.

Warp launched from OBSERVE leaves `cameraMode` as `'observe'` for the
duration (the animate loop branches on `warpState` first, so the value
is purely cosmetic) and keeps `uHideFocusIdx` pinned to the source star
across all three phases — the reorient starts with the camera at A, and
unhiding it would briefly render the focal disc from inside. See
`src/client/README.md` §OBSERVE mode and the warp state machine for the
finishWarp anchor-swap that avoids a mid-warp UI flicker.

Distance-label-as-warp-trigger UI:
`index.html` wraps the distance label and a static `→ Warp` sibling
`<text>` in a `<g id="dist-ui">`. The group has `pointer-events: auto`
and `:hover` reveals the warp suffix via CSS opacity transition. The
label itself is still `text-anchor="middle"` and positioned dead-center
on the measurement vector; the warp suffix is computed each frame as
`mx + label.getComputedTextLength()/2 + WARP_GAP_PX` so the distance
stays visually anchored while the suffix extends to the right.


## Warp controller (`camera/warp-controller.ts`)

`WarpController` owns the 3-phase warp FSM:

1. **Reorient** — quaternion slerp + radial easing around the source
   anchor, ending with the camera on the A→B line outside the source's
   parking radius. Per-frame `lookAt(A)` in navigate mode; a captured
   `reorientEndQuaternion` for observe-launches where `mag0 ≈ 0`
   collapses the lookAt path.
2. **Fly** — position lerp along the line, delegated to
   `camera-motion.ts`'s `tickArrival` so focus-park, unfocus, and warp
   Fly share one arrival profile. Fires a one-shot mid-Fly
   floating-origin recentre onto the destination via `tryMidFlyRecentre`
   once the camera passes the trajectory midpoint, plus a chart-mode
   plateau-trigger that pivots to phase 3 early when the destination
   disc has flatlined.
3. **Post-arrival** — quaternion slerp back to the warp-start orientation
   (parallax view), plus an observe-mode position lerp `pEnd → B`. Skipped
   on navigate arrivals because `TrackballControls.update()`'s per-frame
   `lookAt(target)` would overwrite a slerped quaternion one frame later.

Public surface — `warpTo(destIdx)`, `warpToCloud(destIdx)`, `skip()`,
`tick(nowMs)`, `isActive()`, `isRecenteredToDest()`, `getWarpInfo()`,
`getWarpPhase(nowMs?)`, `dispose()`.

Cross-controller coupling lives behind the `FocusOps` interface
(declared in `focus-controller.ts`, re-exported from
`warp-controller.ts` for back-compat with prior import paths):
per-kind `FocusTarget` factories, current-focus dispatch,
floating-origin recentre, mutation of `focusedStar` / `focusedCloud` /
vector slots, observe-transition busy gate, and the lerp-cancel pair
`startWarp` calls before claiming the camera. `FocusController` is
the implementor (9mm.194.8); the frame-anchor and vector-slot
methods on the interface are delegated back to the integration shell
via `FrameAnchor` and `setVectorTo` / `setVectorToCloud` deps so the
star-pipeline buffer (`_localPositions`) keeps living next to the
resources it touches.

Bus events emitted from the controller:
- `'warp'` (boolean) — true at startWarp, false at finishWarp.
- `'state'` — at startWarp, at finishWarp (via swapObserveAnchor on
  observe→observe arrivals, or via `setFocus` / `setFocusedCloud` on
  navigate arrivals).
- `'focus'` (number | null) — only from `swapObserveAnchor`.

See `src/client/camera/warp/README.md` for the phase math and `src/client/camera/arrival/README.md`
for the shared Fly arrival profile.

## FocusController (`camera/focus-controller.ts`)

`FocusController` owns the focus FSM and the focus-park lerp:

- **Focus state** — `focusedStar`, `focusedCloud`, `focusedPlanetSystem`,
  `planetSystemToken`. Mutually exclusive (star ↔ cloud); the second
  setter clears the first via the standard `setFocus(null)` /
  `setFocusedCloud(null)` paths so a single event ordering rule
  (`'cloudFocus'` before `'focus'`) covers every swap.
- **Focus-park lerp** — `focusLerpState` plus `startFocusLerp` /
  `endFocusLerp` so subscribers see exactly one true→false `'focusLerp'`
  edge per lerp regardless of how many `setFocus` writes happen during
  the in-flight animation. `tick(nowMs)` ticks the lerp through
  `tickFocusLerp`; the integration shell dispatches here when
  `isFocusLerpActive()` is true.
- **Click/select-driven focus** — `focusStar`, `setOrbitTarget`,
  `flyToCloud`, `setOrbitTargetCloud`, `unfocus`. Each gates on
  `getWarp().isActive()` and cancels any in-flight focus-park /
  unfocus lerp before claiming the camera.
- **Pin geometry** — `isPinEngaged()`, `getPinEngageThresholdSq()`.
  The per-frame guard reads the controller; see the dedicated
  Pin-to-center section below.
- **`FocusTarget` factories** — `makeStarFocusTarget`,
  `makeCloudFocusTarget`, `currentFocusTarget`. Each closes over the
  current focus state and the controller's deps (catalog, controls,
  camera, bus, frame anchor, clouds getter) so the returned object can
  read absolute / local positions, mutate per-kind state, and emit
  through the shared event bus without exposing controller privates to
  `focus-target.ts`.

Public surface — see the file for the full method list. The cross-
controller seam is the `FocusOps` interface (consumed by WarpController)
and `ObserveFocusOps` (consumed by ObserveTransition); FocusController
implements both, with frame-anchor + vector-slot methods delegated
back to the integration shell.

Construction cycle — `WarpController` and `ObserveTransition` both
take `focus: FocusOps` from `FocusController`, but `FocusController`'s
guards read back into those controllers (`getWarp().isActive()` etc.).
The cycle is broken by `getWarp: () => this.warp` and
`getObserve: () => this.observe` lazy refs: FocusController is
constructed first (with neither dep wired), Warp + Observe are
constructed next (with `focus: this.focus`), and the lazy getters
resolve at first request. This is the same pattern Picker uses for
async-attached layers (`getClouds`, `getLocalGroup`).

Bus events emitted from the controller:
- `'focus'` (number | null), `'cloudFocus'` (number | null),
  `'planetSystem'` (PlanetSystem | null) — focus state mutations.
- `'focusLerp'` (boolean) — focus-park lerp start / end edges.
- `'cameraMode'` (CameraMode) — from `setFocus`'s observe-cleanup
  branch (focal star changing while in observe mode).
- `'state'` — at every focus mutation + focus-lerp edges.

The `FrameAnchor` interface stays on Stellata — `recenterOrigin`,
`getWorldOffset`, `starLocalPosition`, `starLocalPositionInto`. These
read or rewrite the star-pipeline `_localPositions` buffer plus
the `iPositionAttr.needsUpdate` write, which all live next to the
ShaderMaterial they touch. Cleaner extraction is coupled to the
StarPipeline extract (9mm.43) and deferred until then.

## FocusTarget contract

Warp, focus-park lerp, mid-Fly recentre, and any future camera-transition
code consume focusable objects through the **`FocusTarget` interface**
(`src/client/camera/focus-target.ts`). The warp animation has no
kind-switch statements — adding a new focusable kind (planet, probe,
nebula, exoplanet, …) consists of:

1. Implementing the interface (typically as a factory method on
   `FocusController` that returns an object closing over the per-kind
   catalog / state / event-bus references).
2. Plumbing pick / click handling for the new kind so its
   `FocusTarget` can be passed to `startWarp` / `focusStar`-style
   entry points.

That's it. The warp internals (`updateWarp`, `finishWarp`, mid-Fly
recentre, pin guard, scale-bar focus tracking, …) stay agnostic above
this seam and do not need to change. This is the bar set by
stellata-2br.5 — no future-kind work should ever need to touch the
warp animation code again.

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

The applyFocus/emitFocusEvents split is what lets the mid-Fly recentre
(stellata-2br.5) mutate focus state at the trajectory midpoint
without firing UI-visible events ~half a warp duration before the
camera actually arrives — events settle in lock-step with the
landing.

### How the warp consumes it

`WarpState` carries `source: FocusTarget` and `dest: FocusTarget`. The
warp animation reads geometry via the interface methods and mutates
focus state via `dest.applyFocus()` (mid-Fly recentre) and
`dest.emitFocusEvents()` (`finishWarp`). No `destKind` switches
remain in the warp pipeline; the dispatch table sits in the
`makeStarFocusTarget` / `makeCloudFocusTarget` factory methods on
`FocusController`, which is the one place that needs editing when a
new kind is added.

## OBSERVE mode and the warp state machine

OBSERVE parks the camera at the focused star's local origin and hides
the focal disc via `uHideFocusIdx`. Two gotchas worth noting up front:

1. **`cameraMode` stays `'observe'` throughout an observe→observe warp.**
   `startWarp` from observe disables `observeControls` and sets a
   per-warp `returnToObserve` flag, but does not flip `cameraMode` or
   emit `'cameraMode'`. The animate loop branches on `warpState`
   first, so the value is purely cosmetic during the flight — but every
   listener bound to `'cameraMode'` (mode toggle, search-row
   label, etc.) stays settled. Without this, observe→observe arrival
   visibly flickers through navigate mid-warp.
2. **`finishWarp` re-anchors via `swapObserveAnchor`**, not `setFocus`,
   when `returnToObserve` is true. `setFocus` would see
   `cameraMode === 'observe'` and run its observe-cleanup branch
   (`uHideFocusIdx = -1`, emit `'cameraMode'`), recreating the
   flicker. `swapObserveAnchor` recentres the floating origin, updates
   `focusedStar`, repoints `uHideFocusIdx` to the new anchor, and snaps
   the camera to `(0, 0, 0)` local without touching `cameraMode`.

Source-star hide (`uHideFocusIdx = focusedStar`) stays pinned across the
entire warp duration when launched from observe — the reorient phase
starts with the camera *at* the source star, and unhiding it would
briefly render the disc from inside.

## Pin-to-center (`uPinFocusToCenter`)

After the physical-orbit floor (`R / tan(0.45·fovMinor)` for a Sol-class
star) brings the camera to ~5e-8 pc on close approach, float32 cancellation
in the projection chain (`projectionMatrix * modelViewMatrix * vec4(0)`)
drifts the projected centre by visible pixels even though the focused
star is mathematically at view-origin. Float64 emulation was rejected
as too heavy; instead `star.vert.glsl` exposes a `uPinFocusToCenter: int`
uniform (-1 = disabled). When set, the shader replaces the projection
chain with `projectionMatrix * vec4(0, 0, -dPc, 1)` for the matched
`gl_InstanceID` — bypassing matrix-multiply cancellation entirely. One
int uniform, ~5 lines of GLSL, no CPU cost.

JS-side per frame in `stellata.ts`: pin engages iff
`FocusController.isPinEngaged()`, which checks
`focusedStar !== null && cameraMode === 'navigate'
&& (!warp.isActive() || warp.isRecenteredToDest())
&& !aim.isActive() && !focusLerpState
&& controls.target.lengthSq() < 1e-12`.

The `warp.isRecenteredToDest()` clause relaxes the pin guard for the
post-recentre window of warp Fly: after the mid-Fly recentre
(stellata-2br.5) the destination is at local `(0,0,0)` and the camera
is doing `lookAt(local origin)` per frame, so pin-to-NDC matches the
geometry `lookAt` is already computing. The shader pin then bypasses
any residual Float32 noise in the projection chain through to
`finishWarp`. The `focusLerpState` clause stays unconditional —
focus-park slerps the camera quaternion through an arc that's not
continuously aimed at the focal star, so pinning would snap-jump it
to NDC origin before the slerp finishes rotating into it.

**Load-bearing invariant:** `controls.target` must be `(0,0,0)`
*exactly* (length < 1e-6 pc). Any code path that engages focus while
leaving target at a non-trivial residual silently disengages the pin.
Three residual sources have bitten this:

1. **Sol's catalog offset.** Sol is at AT-HYG `(5e-6, 0, 0)` pc, not
   `(0,0,0)`. `recenterOrigin(solPos)` shifts target by `5e-6` →
   guard fails on first frame.
2. **Float32 truncation on long warps.** `finishWarp`/`focusStar`
   read target from `_localPositions` (Float32Array), then
   `recenterOrigin` shifts target by a delta computed fresh in
   float64. The two representations of `|AB|` differ by Float32 ULP
   (~`|AB|·1e-7`); for Sol→Rigel (265 pc) that's `~5e-5 pc`,
   comparable to Rigel's arrival endOffset → 30%-of-screen drift.
3. **Unfocus from close approach.** Solved by removing the
   `recenterOrigin(0,0,0)` from the `setFocus(null)` branch (see
   above) — `worldOffset` stays put on unfocus.

**Fix for #1 and #2** lives at the choke point in
`FocusController.setFocus`'s `idx !== null` branch: after
`recenterOrigin`, subtract `target` from `camera.position` (preserving
cam-to-target offset) and snap target to `(0,0,0)`. Eliminates both
residuals for every caller of `setFocus`.

Limitations: pan moves target away → pin disengages (intentional;
post-pan the focused star isn't at view centre). Doesn't fire in
observe mode or during aim animations. Pin DOES fire during the
post-recentre window of warp Fly (see `warp.isRecenteredToDest()`
in the guard above); pre-recentre Fly stays guarded because the
focused star is the source, not the destination the camera is
flying toward.

**Where to look:**
- `src/client/shaders/star.vert.glsl` — `uPinFocusToCenter` decl + use site.
- `src/client/camera/focus-controller.ts` — `GLOBAL_MIN_DIST_PC = 5e-3`,
  `PIN_ENGAGE_THRESHOLD_SQ_PC = 1e-12`, `setFocus` body (the
  post-recenter snap to origin in the focused branch; empty unfocus
  branch), `isPinEngaged` gating rules.
- `src/client/stellata.ts` — per-frame pin guard in the animate loop
  (reads `focus.isPinEngaged()` + `focus.getFocusedStar()`).
- `src/client/util/url-state.ts` — `DecodedView.worldOffset`,
  encoder/loader.
- `src/client/util/url-state.test.ts` — round-trip regression test.
- `src/client/debug/pin-debug-hud.ts` — Pin section in the unified debug
  panel (`debug.panel()`); live readouts with latched directional
  extremes. **Always use this when investigating any "star drifts
  off-screen" report.**
