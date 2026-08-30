# Camera controls

Camera setup that's mode-agnostic: near-plane vs minDistance geometry,
TrackballControls tuning, and the two-finger roll gesture that works
in both navigate and observe modes.

## Files

- `controls.ts` — settings-panel bindings (distance / FOV / exposure /
  exaggeration sliders, spectral chips, overlay toggles) + the
  slider↔distance log mapping (`sliderToDist` / `distToSlider`). The
  star-size and "Dynamic range" sliders it used to bind are retired
  (`../../filters/README.md` § The multiplier is the ONLY footprint
  control), as are the galactic-glow and "Show constellations" checkboxes —
  both are the declutter floor's call now (`../../scene/README.md`).
  The two segmented stop
  controls (detail level, coordinate sphere) are bound
  and synced through `../../ui/stop-control.ts` (`../../ui/README.md`
  § Stop controls), not open-coded here. Reverse-sync runs off
  `'filter'` / `'cameraMode'`; the one exception is the coordinate-sphere
  control's disabled state, which tracks camera distance and so rides
  `'frame'` behind a cached flag (`../../galactic/coord-spheres/README.md`).
- `input/` — canvas gestures + the camera state they drive: the click
  FSM, the two roll authorities (camera.up and the quaternion), the roll
  gestures, pinch-to-zoom, and TrackballControls' own tuning. Its
  `README.md` replaces this one for reads inside that folder.
- `mode-toggle.ts` — navigate / observe pill in the topbar.
- `picker.ts` — pure target resolver. **Two-stage brightness gate:** the
  catalog-wide scan prunes on the star's *intrinsic* magnitude against
  `drawCutoffMag`, then each surviving candidate goes through
  `resolveStarPick`, which folds in the terms that magnitude cannot see —
  per-star dust extinction, the live adaptation cut, the faint-end toe —
  and reports both whether the frame renders the star and the disc radius
  it actually draws. The scan's bright-extreme reach for variables comes
  from `activePulsationAmp`, the one CPU mirror of the shader's
  `iSuppressPulsation` gate — an eclipser gets no reach, because its disc
  never swings bright. Prefiltering on the intrinsic value is sound only
  because every omitted term dims (`../../hdr/exposure/README.md` § What
  "visible" means to a pick path); making it the *gate* is the bug that
  had clicks landing on stars in empty sky. The confirm step costs a GPU
  readback per candidate, so `pickFromCandidatesResolved` walks the score
  order lazily and stops at the first candidate that renders. The
  prefilter's radius must be an **upper bound** of the resolved one or
  the prime/fallback partition mis-tiers — in chart mode that means
  bounding the magnitude-mapped ink disc as well as the realistic
  footprint, since either can be the larger
  (`Stellata.pickPrefilterSizePxFor`).
  It owns the two-tier star pick
  (`pickStar` / `pickStarHit` — the star module's hover leg calls back
  into it, so the engine-owned scan stays here); every other kind picks
  through `pickKindHit`, which dispatches to the module's
  hover-provider pick — literally the same function the hover engine
  runs, so click and hover can't disagree (a cloud's
  overlapping-winner resolution stays in `MolecularClouds.pick`,
  `../../molecular-clouds/README.md` § Picking + hover). Both star pick
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
- `star-pick-visibility-pure.ts` (+ test) — the decision half of
  `resolveStarPick`, split out so it is testable without a live shell.
  Beyond the photometric gate it mirrors the two **off-screen-sentinel
  collapses** a pick would otherwise sail straight through:
  `uHideFocusIdx` (the focal star in OBSERVE — drawn nowhere, sitting
  dead centre of the screen) and `iEclipseDim` at totality. The eclipse
  term is **glow-pass only**, matching the shader's glow-pass gate: a
  disc-dominant star keeps drawing at any dim and the local depth
  pass orders the resolved pair geometrically, so mirroring the dim there
  would hide a star that is on screen. The pass routing is
  `colourPassFor` (`../../star-pipeline/star-pass.ts`, over
  `isDiscDominant`), not a local re-derivation. A partial dim also
  **shrinks the quad**, because
  the shader folds it into `appMag` before deriving `pxSize` — so the
  radius re-solves through `appSizePxForMag` rather than reporting the
  undimmed size. Below a quad of `2 × MIN_DISC_HIT_RADIUS_PX` the
  hit-radius floor absorbs that entirely; it bites in the
  PSF-dominated regime and under the star-size exaggeration multiplier,
  where `sizeMax` clears the floor.
- `aim-controller.ts` — mode-aware aim slerps (navigate orbit-pivot
  + observe quaternion-in-place), shared `aimDurationMs` ramp.
- `star-geometry.ts` — pure star angular-geometry formulae
  (θ = 2·atan(R/d), `parkDistForStar` derivations).
- `star-physics.ts` — per-star camera/screen geometry: `fovMinorRad`,
  `peakAmplitudeFactor`, `minOrbitDistForStar`, `parkDistForStar`,
  `renderedSizePx` (+ its `renderedSizeComponents` split — the star
  local cluster's disc/glow membership test reads the two size terms
  separately), `appSizePxForMag` (the perceptual half of that split,
  exposed because the pick re-solves it at the eclipse-dimmed
  magnitude), `activePulsationAmp` (the shared
  `iSuppressPulsation` mirror both the disc-size and pick paths read —
  two mirrors of one shader gate is how they came to disagree),
  `renderedDiscPxAtPeak`, `getChartDiscParams` +
  canonical `ZOOM_FLOOR_FRACTION`, `VAR_TROUGH_FLOOR_FRACTION`. The
  planet siblings `minOrbitDistForPlanet` / `parkDistForPlanet`
  (+ `PLANET_PARK_FILL_FRACTION`) live here too — same angular
  solves, keyed on the body radius directly. Everything here is a
  solve; a kind whose park geometry is a fixed distance instead keeps
  its constants in its own folder (probes —
  `../../solar-system/probes/probe-focus-geometry.ts`, with
  `../depth-range.test.ts` pinning the near-plane margin).

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
   `ZOOM_FLOOR_FRACTION` (= 0.9) of the viewport's minor axis, held
   outside the body's own surface:
   ```
   d_min = max(R / tan(ZOOM_FLOOR_FRACTION × fov_minor / 2),
               R × ORBIT_FLOOR_SURFACE_MARGIN)
   ```
   `fov_minor = min(fov_x, fov_y)` so the 90% target reads consistently
   across portrait + landscape viewports. The rule is uniform across
   the catalog — binary primaries get the same close-approach floor as
   single stars, so the user can inspect either component of α Cen,
   Sirius, or any multiple system without the controls bouncing.
   `d_min` scales linearly with the star's physical radius — inspecting
   a Sol-class star vs Betelgeuse vs Sirius B looks the same on screen.

   **The surface clamp is not decoration.** The bare solve drops below `R`
   once `tan(0.45 × fov_minor) > 1` — filling 90 % of the minor axis is
   then unachievable from outside the body at all, and the solve answers
   with the mathematically correct interior distance. The FOV slider
   reaches `FOV_MAX_DEG = 120°`, where the bare solve is `0.727 R`: the
   camera zooms inside a focused Jupiter. `ORBIT_FLOOR_SURFACE_MARGIN`
   (= 1.05) is the shared clamp both hard-kind floors take.

   **Two thresholds, three degrees apart — don't conflate them.** The bare
   solve reaches exactly `R` at `fov_minor = 100°`; the *clamp* starts
   binding at **96.895°**, where the bare solve reaches `1.05 R`. Above
   that second angle `d_min` is FOV-invariant, which is why widening
   `FOV_MAX_DEG` no longer thins the near-plane margin.

   **The clamp costs screen fill, by design.** At the floor the body
   subtends `2·atan(R/d)`, so past the crossover it stops reaching
   `ZOOM_FLOOR_FRACTION`:

   | `fov_minor` | bare solve | floor | fill at the floor |
   |---|---|---|---|
   | 50° | 2.414 R | 2.414 R | 0.900 |
   | 100° | 1.000 R | 1.050 R | 0.872 |
   | 120° | 0.727 R | 1.050 R | 0.727 |

   Max zoom at the wide end therefore frames a body ~19 % smaller than the
   pre-clamp build did — the trade for not being inside it. The
   `../../star-pipeline/perceptual-disc/README.md` claim that a max-radius
   star at the floor fills 0.9 holds only below the crossover.

   **1.05 specifically.** The mesh's equatorial radius *is* `radiusKm`
   (flattening only shortens the polar axis), so 5 % clears the giants'
   oblateness — Saturn's f = 0.098 is the worst case — everywhere on the
   body, and it leaves the smallest focusable moon 6.744× above
   `CAMERA_NEAR_PC` (`../depth-range.test.ts`). It clamps against the
   **solid surface**, not the drawn extent: a thick haze shell still
   reaches past it (Titan's tops out at 1.117 R), which the scattering
   march handles — it starts at `max(t0, 0)` for a camera inside the shell.
   Rings are deliberately not covered either; flying between the rings and
   the cloud tops is a legitimate vantage.

   Both auto-park solves stay outside the clamped floor at every reachable
   FOV (`star-physics.test.ts` sweeps the whole slider). The clamp
   deliberately lives in the floor wrappers, **not** in
   `distAtFillFraction` — the 30 %-fill planet park solve is outside the
   surface at every reachable FOV (~3.1 R even at 120°) and must keep
   returning the bare angular distance.

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
     dMinFloor  = minOrbitDistForStar's surface-clamped 0.9-fill solve
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

## Aim controller (`camera/controls/aim-controller.ts`)

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
