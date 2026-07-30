# Camera controls

Camera setup that's mode-agnostic: near-plane vs minDistance geometry,
TrackballControls tuning, and the two-finger roll gesture that works
in both navigate and observe modes.

## Files

- `controls.ts` — settings-panel bindings (distance / exposure / size
  sliders, spectral chips, overlay toggles) + the slider↔distance log
  mapping (`sliderToDist` / `distToSlider`). The two segmented stop
  controls (detail level, coordinate sphere) are bound
  and synced through `../../ui/stop-control.ts` (`../../ui/README.md`
  § Stop controls), not open-coded here. Reverse-sync runs off
  `'filter'` / `'cameraMode'`; the one exception is the coordinate-sphere
  control's disabled state, which tracks camera distance and so rides
  `'frame'` behind a cached flag (`../../galactic/coord-spheres/README.md`).
- `input/` — canvas gestures + the camera state they drive: the click
  FSM, the reference up axis (galactic-north roll lock), the roll
  gestures, pinch-to-zoom, and TrackballControls' own tuning. Its
  `README.md` replaces this one for reads inside that folder.
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
