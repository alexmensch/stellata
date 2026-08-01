# Focus FSM

What it means to "focus" an object. The focus state, the kind-agnostic
`FocusTarget` interface that lets the camera and overlays talk about
stars, clouds, and any future focusable kind through one contract, the
focus-park lerp, and the `uPinFocusToCenter` shader pin that keeps a
close-approach focused star sitting at exactly NDC origin.

## Files

- `focus-controller.ts` (+ test) — the FSM. Owns the focused object
  and the distance-vector destination (one `Target` slot each — see
  § Focus state), `cameraMode`, `focusedPlanetSystem`, the focus-park
  lerp state, pin-engage geometry, and the generic `makeFocusTarget` /
  `currentFocusTarget` builders. Canonical home for
  `GLOBAL_MIN_DIST_PC` + `PIN_ENGAGE_THRESHOLD_SQ_PC`.
  Implements the `FocusOps` interface consumed by `WarpController` and
  the `ObserveFocusOps` interface consumed by `ObserveTransition`.
- `focus-target.ts` (+ test) — the `Target` sum type (`{kind, idx}`,
  kind = `'star' | 'cloud' | 'lg' | 'planet' | 'shell' | 'probe'`), the
  `KIND_TRAITS` hard/moving declarations, the `FocusableProviders`
  registry contract (§ FocusableProviders), and the `FocusTarget`
  camera-transition view built generically from it, so warp / overlays /
  arrival math can read positions and emit events without knowing the
  kind. A planet Target's idx is the PlanetBodyField flat global
  instance index; (host, planet-within-host) resolve through the
  field's attach table. A probe Target's idx is the ProbeField
  loaded-roster index.
- `focus-transition.ts` (+ test) — `tickFocusLerp` + the generic
  `parkDistance(...)` + `newFocusLerpFrom(...)` primitives. Star-,
  cloud-, and future-focusable-park-arrivals all compose these. The
  per-frame motion delegates to `../arrival/camera-motion.ts`.

`FrameAnchor` (recenterOrigin / worldOffset / starLocalPosition) is
implemented by `stellata.ts`, but only as the camera / orbit-target /
scene-layer half of a recentre: the buffer itself belongs to
`StarFrame` (`../../star-pipeline/frame/README.md`), which
the shell delegates to.

## Focus state

- `focused: Target | null` and `vector: Target | null` — one sum-type
  slot per family, so cross-kind mutual exclusion (star ↔ cloud ↔ LG
  ↔ planet ↔ shell ↔ probe) is structural rather than enforced by
  pairwise clears.
  The `'focus'` and `'vector'` events carry the kind-tagged
  `Target | null` payload, so a kind change is a single emit — no
  clearing emit for the displaced kind precedes it; subscribers
  re-read state or switch on `payload.kind`.
- `cameraMode` lives here too — `getCameraMode()` is the single read
  path; `setCameraModeValue()` is the raw no-emit write used by
  ObserveTransition and the observe-cleanup branch of `setFocus`.
- `focusedPlanetSystem`, `planetSystemToken` — derived star-focus
  state.
- Click/select-driven entry points are Target-keyed: `flyTo(target)`
  (hard kinds route through `focusHardTarget`; soft kinds share one
  provider-driven focus-park path), `setOrbitTarget(target)`,
  `setVector(target | null)`, `unfocus` (including the vector-only wipe
  when nothing is focused). Each gates on `getWarp().isActive()` and
  cancels any in-flight focus-park / unfocus lerp before claiming the
  camera.

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
- `'focus'` (Target | null), `'vector'` (Target | null),
  `'planetSystem'` (PlanetSystem | null) — focus state mutations.
- `'focusLerp'` (boolean) — focus-park lerp start / end edges.
- `'cameraMode'` (CameraMode) — from `setFocus`'s observe-cleanup
  branch (focal star changing while in observe mode).
- `'state'` — at every focus mutation + focus-lerp edges.

## FocusTarget contract

Warp, focus-park lerp, mid-Fly recentre, and any future
camera-transition code consume focusable objects through the
**`FocusTarget` interface** (`focus-target.ts`). Instances are built
generically by `FocusController.makeFocusTarget` from the kind's
`FocusableProvider` — there are no per-kind factories. Adding a new
focusable kind (nebula, exoplanet, …) consists of:

1. Declaring the kind's `KIND_TRAITS` row and its `FocusableProvider`
   entry in `stellata.focusables` (both records are exhaustive over
   `TargetKind`, so `tsc` fails until both exist).
2. Plumbing pick / click handling for the new kind so its `Target` can
   be passed to `warpTo` / `flyTo`-style entry points.

That's it. The focus mutations (`flyTo`, `setOrbitTarget`, the warp's
`applyFocus`) and the warp internals (`updateWarp`, `finishWarp`,
mid-Fly recentre, pin guard, scale-bar focus tracking, …) stay agnostic
above this seam and do not need to change.

### The interface

```ts
interface FocusTarget {
  readonly kind: TargetKind;         // extend the union per new kind
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
| `localPositionInto` | Per-frame `camera.lookAt(...)` source during warp Fly. Also used by overlays that project the object's position, and as the warp's source-`A` / dest-`B` derivation in `warpTo`. |
| `parkRadius` | The warp computes `pStart` / `pEnd` as `anchor − travelDir · parkRadius()` for source and destination respectively — symmetric across both endpoints. |
| `applyFocus` | Sets the per-kind `focusedStar` / `focusedCloud` / etc. field, updates derived state (`minDistance`, planet system attach), clears whichever sibling-kind focus was set. **No events fire.** |
| `emitFocusEvents` | Fires the deferred `'focus'` emit (kind-tagged Target payload) then `'state'`. Called from `finishWarp` after the camera lands. |
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
`dest.emitFocusEvents()` (`finishWarp`). No `destKind` switches exist
anywhere in the pipeline: `FocusController.makeFocusTarget(target)`
binds the kind's provider legs to one (kind, idx), and `applyFocus` /
`emitFocusEvents` are single shared implementations reading the
provider's `orbitFloor` / `planetSystemHost` data legs.

## FocusableProviders — the kind-agnostic geometry registry

`FocusableProviders` (`focus-target.ts`) is a mapped type EXHAUSTIVE
over `TargetKind` — **adding a focusable kind without a provider fails
`tsc`**, the same compile-time contract `FocusCardProviders` and
`KIND_TRAITS` carry; `focus-target.test.ts` pins all of them with
`@ts-expect-error`. Each provider holds every per-kind leg the
kind-agnostic code dispatches through: `anchorInto` (absolute recentre
anchor), `localPositionInto`, `focusParkDistance` (the landing distance
of every park), `orbitFloor` (the manual-zoom floor a focus applies),
`arrivalRadiusPc` (angular-size ease input; null → log-d fallback),
`renderedSizePx` (overlay chevron / silhouette sizing),
`chartPlateauDistance` (warp chart-mode pivot; null → no chart disc),
and `planetSystemHost` (which star's planet system attaches; null →
detach). Hard/soft and moving membership are NOT provider legs — they
are declared data in `KIND_TRAITS`, readable without the registry
(`isHardTarget` is the predicate).
The registry is constructed once in `stellata.ts` (exposed as
`stellata.focusables`); lazily-attached layers are read through
closures, so attach cycles need no re-registration. Overlays and
pickers dispatch `focusables[target.kind].<leg>(target.idx)` instead
of per-kind shell methods.

**User-facing interaction affordances are kind-generic — never
special-case any kind in UX behaviour.** An object is an object: it
sits at coordinates and observes the general rules of the click state
machine, focus, POI pinning, the distance vector, Esc, observe, and
warp, all of which operate on `Target`s. Every kind — current or
future — joins by implementing the existing contracts (FocusTarget,
provider legs, `PoiStore.pinnable`), with zero interaction-layer
edits; a per-kind branch in the shell or the input FSM is a
review-blocking defect, whatever the kind.

**Internal star-only mechanisms stay guards, not provider legs.** The
binary orbital ride and `uPinFocusToCenter` guard on
`getFocusedStar()`, which returns null for every non-star kind — so
kind N+1 passes through them untouched. A mechanism gains an optional
provider member only when a second kind actually implements it; the
moving-focal ride is the worked example — added for planets as the
analogue of the binary ride, and when probes arrived they needed only
a provider leg and a `moving: true` trait, no ride of their own.
Don't add speculative capability methods before the second kind.

## Hard kinds — star, planet, probe

The three **hard** focus kinds all recentre the floating origin onto the
object and drop `controls.minDistance` to a per-object physical floor;
clouds, LG objects, and boundary shells stay **soft** (no recentre, no
floor change). Membership is declared per kind in `KIND_TRAITS`;
`isHardTarget` is the single predicate — never spell the membership out
at a call site.

One generic pair serves every hard kind: `focusHardTarget` (the flyTo
leg — `focusStar` is its star-index shim) and `setHardFocus` (the
setFocus-analogue: observe bail-out, recentre onto the provider's
`anchorInto`, `orbitFloor` drop, `planetSystemHost` attach,
pose-preserving target snap). Both share `parkOnFocalTarget` for the
lerp-in / snap / stay-put tail, so a fourth hard kind supplies only its
provider legs and traits row. The one star-only branch: the star's
target snap runs through `setFocus`, whose float64 live-position
accessor (baseline + orbital perturbation) the provider's buffer-read
leg can't replace — see § Pin-to-center. Displacing a
non-star hard focus — `setFocus(null)`, a soft kind, or Esc — runs the
same detach side effects a star unfocus does (floor clamp to
`min(GLOBAL_MIN_DIST_PC, eye)`, planet-system detach).

Everything the controller reads for a focus — focal local position,
park distance, orbit floor, planet-system host — dispatches through
`FocusableProviders`, not through a per-kind field reference. A test
harness that stubs one of those legs is therefore answering for the
field, which is exactly the bug `focus-controller.test.ts` wires its
hard-kind + shell legs to real fields to avoid.

- **Planet floors/parks** come from `star-physics.ts`:
  `minOrbitDistForPlanet` (the same 90 %-fill solve stars use) and
  `parkDistForPlanet` (a 30 %-fill solve — purely angular, no 1 AU term,
  because a planet is a dim reflected-light body whose park has to
  actually show the disc).
- **Probe floors/parks are fixed distances, not solves.** A probe marker
  is a fixed-pixel glyph with no disc to fill, and a metre-scale
  spacecraft solve lands inside the near plane — see
  `../../solar-system/probes/README.md` § Park distance is set by the
  near plane.
- **Host-derived state stays alive.** The planet kind attaches the
  HOST's planet system (orbit rings, heliopause, labels) exactly as the
  host's own star focus would; probe focus attaches Sol's for the same
  reason (the rings are what make a flythrough planet pass legible).
- **Observe anchors.** All three hard kinds are valid observe anchors
  (`getFocusedHardTarget`); the focal-body hide dispatches per kind
  through `setFocalBodyHidden` in `stellata.ts`.
- **No shader pin.** `uPinFocusToCenter` is a star-instance pin; the
  moving kinds are kept under the camera by the ride below instead.

## Moving-focal ride

A focused planet sweeps its orbit and a focused probe runs its
trajectory, both fast under scrubber fast-forward. `applyMovingFocalRide`
in `stellata.ts` — the sibling of the binary focal-frame ride, over the
shared `focalRideStep` — translates camera + orbit target + in-flight
pose caches by the object's per-frame local-position delta, so pan
offsets survive and the object stays glued to `controls.target` at any
rate. That is what makes the probe flythrough hold.

It is one slot for both kinds, read through
`focusables[kind].localPositionInto`, with membership declared as
`moving: true` in `KIND_TRAITS`. Two things keep it correct:

- **The ride reseeds on every `'focus'` event.** Each hard focus
  recentres the origin, staleing the cached last position — and it is
  also what makes the shared slot safe when the kind changes but the
  index collides (planet 3 → probe 3), since the slot is keyed on index
  alone.
- **It must run after every moving-body field has written this frame's
  positions.** The probe layer is registered ahead of the planet layer
  for exactly this: the ride call sits in the planet layer's update, so
  both fields are fresh when it fires. One frame of lag is invisible at
  1× and a visible offset at high fast-forward.

Float32 precision as the object travels far from the focus-time origin
is held generically by the origin-follow recentre
(`../../binaries/README.md` § Focal-frame ride — kind-agnostic, no
per-kind pin), which reseeds the ride when it fires.

## Focus-park lerp

Click-focus on a star (or `flyTo` for the soft kinds) doesn't
teleport. The lerp lives here as the generic `parkDistance(...)` +
`newFocusLerpFrom(...)` + `tickFocusLerp(...)` trio — stars consume it,
the soft kinds compose the same primitives through their provider's
`focusParkDistance`, future focusable kinds plug in the same way.

Branch in `focusStar` / the soft-kind leg of `flyTo`:

- **`eyeDist <= parkDist` → stay put (`focusStar` only).** Camera
  doesn't move; only `controls.target`, `controls.minDistance`, and
  focus state update. You can sit close to a star, so a re-focus
  shouldn't yank the camera back out.
- **`eyeDist > parkDist` → lerp.** Camera position lerps from
  `fromPos` to `toPos = target + (eye-direction × parkDist)` and
  camera orientation slerps in parallel from `fromQuat` to a
  quaternion that looks at the target from `toPos` **with the reference
  up axis as up, not the live `camera.up`** — the end pose looks down a
  different axis than the start, so resolving roll against the start-pose
  up lands on a roll the per-frame correction undoes one frame later, as
  a visible pop (`../controls/input/README.md` § Reference up axis). Both
  interpolations are driven by the same smoothstep, so the camera
  continuously rotates toward the new target as it flies in. Builds
  the lerp **after** `setFocus` recentres the floating origin so
  `fromPos` / `toPos` live in the post-recentre frame.
- **Soft-kind `flyTo` moves to `parkDist` in BOTH directions.** A soft
  focus frames the whole extended object, so it flies OUT as well as in
  — required for a boundary shell the camera sits *inside* (Sol inside
  the Local Bubble / heliopause), where staying put leaves the
  back-face-culled shell invisible. Only a near-exact match (already at
  park) stays put.
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
lerp is in flight — `controls.target` is already on the focal star's
live position in the post-recentre frame, so the pin would otherwise
snap the focal star to NDC origin while the camera is mid-rotation,
making the star appear pasted at screen centre instead of following
the rotation naturally.

`#overlay` (HUD arrows + ring, focus ring, distance vector,
constellation lines, POI labels, etc.) is hidden for the lerp's
duration via a `body.focus-lerping` class — same mechanism the warp
uses (`body.warping`). Stellata fires the `'focusLerp'` event on
start / end edges; `main.ts` toggles the body class.

`cancelFocusLerp` is wired at every site that already calls
`cancelUnfocusLerp` (`focusStar`, `flyTo`, `unfocus`,
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
&& controls.target.distanceToSquared(focalLivePos) < 1e-12`,
where `focalLivePos` is the focal star's LIVE local position read from
`_localPositions` (catalog baseline + orbital perturbation). For a
non-orbiting star that reduces to the local origin, so the check is the
historic `target ≈ origin` test; for a binary member it tracks the
star's perturbed position, which the focal-frame ride keeps
`controls.target` glued to.

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

**Load-bearing invariant:** `controls.target` must equal the focal
star's live local position *exactly* (within 1e-6 pc). Any code path
that engages focus while leaving target at a residual off the star
silently disengages the pin. Residual sources that have bitten this:

1. **Sol's catalog offset.** Sol is at AT-HYG `(5e-6, 0, 0)` pc, not
   `(0,0,0)`. `recenterOrigin(solPos)` shifts target by `5e-6` →
   guard fails on first frame.
2. **Float32 truncation on long warps.** `finishWarp`/`focusStar`
   read target from `_localPositions` (Float32Array), then
   `recenterOrigin` shifts target by a delta computed fresh in
   float64. The two representations of `|AB|` differ by Float32 ULP
   (~`|AB|·1e-7`); for Sol→Rigel (265 pc) that's `~5e-5 pc`,
   comparable to Rigel's arrival endOffset → 30 %-of-screen drift.
3. **Unfocus from close approach.** `setFocus(null)` leaves
   `worldOffset` put (no `recenterOrigin(0,0,0)`).
4. **Orbital drift of a binary focal.** The focal star moves along its
   orbit each frame; a static target would fall off it. The focal-frame
   ride (§ binaries/README) translates `controls.target` by the star's
   per-frame perturbation so target stays on the star.
5. **Space-motion re-advance under time scrubbing.** A scrubbed clock
   re-runs the epoch-advance pass, moving the focal star's baseline
   mid-focus. `maybeReAdvanceEpoch` (`stellata.ts`, over
   `StarFrame.advanceEpochTo`) translates camera,
   target, and the in-flight transition pose caches by the focal's
   exact space-motion delta in the same step — the ride's follow
   contract applied to proper motion (skipped during warp, like the
   ride).

**Fix for #1, #2, #4** lives at the choke point in
`FocusController.setFocus`'s `idx !== null` branch: after
`recenterOrigin`, snap target onto the focal's live local position
(`starLivePositionInto` = catalog baseline in the current frame +
float64 orbital perturbation) and shift `camera.position` by the same
delta (preserving the cam-to-target offset). Eliminates the residuals
for every caller of `setFocus`; the per-frame ride then maintains #4.

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
