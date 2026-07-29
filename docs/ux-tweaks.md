# UX knobs

Reference table of common tweaks the user may ask for and where to find them.
See also `src/client/star-pipeline/README.md`, `src/client/galactic/README.md`,
`src/client/molecular-clouds/README.md`, `src/client/milkyway/README.md`, `src/client/chart-mode/README.md`,
`src/client/camera/controls/README.md`, `src/client/camera/warp/README.md`, `src/client/camera/observe/README.md`,
`src/client/ui/README.md`, and `src/client/overlays/README.md`
for the surrounding context.

## Known UX knobs you may be asked to tweak

- **Orbit feel** — `rotateSpeed` / `dynamicDampingFactor` in
  `stellata.ts` constructor.
- **Camera pan** — gone; `noPan` stays `true`. Orbit + dolly + roll only.
- **Roll level-lock strength / pole cone** — `POLE_CONE_DEG` in
  `camera/controls/input/reference-up-pure.ts`. `SNAP_TO_LEVEL_DEG` beside it
  is the alignment-guide band the roll sticks inside mid-drag; which frame it
  sticks to follows the displayed coordinate sphere
  (`coordSphereNorthPole`, `galactic/coord-spheres/README.md`). Roll dead-zone
  is `ROLL_DEADZONE_PX` in `input-controller.ts`.
- **Pinch-zoom rate** — `PINCH_NOTCH_GAIN` in
  `camera/controls/input/pinch-zoom-pure.ts`: how many scroll notches a
  full two-finger pinch is worth, on both browser pinch signals.
  `PINCH_SCALE_DELTA_PX` beside it only balances WebKit's `scale` report
  against Blink's wheel report — adjust that one if Safari and Chrome
  disagree on rate, and `PINCH_NOTCH_GAIN` if they agree but both feel
  wrong. Scroll rate itself stays `zoomSpeed` (navigate) /
  `FOV_STEP_PER_WHEEL` (observe).
- **Chevron density** — `CHEVRON_SPACING_PX` / `_HALF_WIDTH` / `_DEPTH` in
  `distance-vector-overlay.ts`.
- **Focus ring size** — `RADIUS_PX` in `focus-ring-overlay.ts`.
  `hud-overlay.ts` mirrors the value as `FOCUS_RING_RADIUS_PX` so the
  HUD's shaft-start computation tracks the same circle.
- **HUD ring size** — `RING_SIZE_FACTOR` (5×) and `RING_FOV_ANCHOR_DEG`
  (10°) in `hud-overlay.ts`. The ring radius is
  `RING_SIZE_FACTOR × f.sizeMax × (RING_FOV_ANCHOR_DEG / fov)`. Bump the
  factor to make the OBSERVE-mode HUD ring more prominent at typical
  FOVs; lower the anchor to make zoomed-in views grow the ring more
  aggressively.
- **HUD halo gap** — `RING_HALO_GAP_PX` (4 px) in `hud-overlay.ts`.
  Distance between the active ring rim (focus ring in navigate, HUD
  ring in observe) and the start of the Sol/GC arrow shafts.
- **Constellation polygon prominence** — `#con-polygon` stroke/fill in
  `styles.css` (currently deliberately subtle).
- **Star size target** — `TARGET_PX` (2.16 px) in
  `filters/filter-state.ts`: the pixel size a threshold star lands on at
  every FOV and every viewport height. sizeMin/Max are derived from it
  through `starPxSizes` (with the √Δm factor for max), so this is the one
  number that moves absolute star size. 2.16 preserves the old K = 12 at
  50° / 1080 px — the pre-plate-scale *angular* exaggeration; 3.84 is the
  other defensible anchor (it would preserve rendered pixel size on
  1920×1080 instead, and stars read noticeably larger).
- **Star exaggeration multiplier** — the "Star size exaggeration" slider
  is a multiplier on the plate-scale-derived K (default 1, range
  0.25–4·). Higher = bolder, more cartoonish stars; lower = more literal
  physics. `kDensity` on the instrument record is the per-instrument
  crowding half of K — 1 for the unaided eye, smaller for a deeper
  instrument so a denser field doesn't wash out.
- **Default camera FOV** — `DEFAULT_FOV` (50°) in `stellata.ts`. Reset
  button on the FOV slider snaps back here.
- **EV trim range and step** — `EV_MAX_STOPS` (3) and `EV_STEP_STOPS`
  (1/3) in `hdr/exposure/exposure-epoch.ts`, driving the `#ev` slider.
  Widening the range also widens the derived population cull, since the
  cull bound is the deepest threshold the trim can reach.
- **Soft-taper width** — `SOFT_TAPER_MARGIN_MAG` (0.5) in
  `solar-system/perceptual-magnitude.ts`, used by `magOk`
  (`star.vert.glsl`) and the matching
  `smoothstep(uThresholdMag, uThresholdMag + 0.5, vAppMag)` in the
  fragment shader's glow pass. Wider = softer fade-in at the visibility
  threshold; 0 = hard cutoff. Every CPU "is it drawn?" mirror reads the
  same constant.
- **Warp duration curve** — `WARP_T_MIN_MS`, `WARP_T_MAX_MS`,
  `WARP_T_K_MS` (ms-per-log10-parsec slope) in `stellata.ts`. Also
  `WARP_REORIENT_MS`. Arrival offset is per-star via `minDistForStar`.
- **Physical-size ceiling** — `computePhysMaxPx` in `stellata.ts`
  returns 50% of the smaller viewport axis. Biggest catalog star at
  min orbit distance fills this much. Lower to reduce how dominant
  supergiants feel up close.
- **Variability time compression** — `uSecondsPerDay = 0.2` (1 catalog
  day = 0.2 s real time) and `uMinPeriodSec = 4` (minimum effective
  cycle length, prevents strobing) in `stellata.ts` shared-uniforms.
- **Variability trough floor** — `VAR_TROUGH_FLOOR_FRACTION = 0.2` in
  the vertex shader (and mirrored in `renderedSizePx`). Trough won't
  shrink below 20% of the star's current baseline size.
- **Luminosity-class softness range** — `mix(3.0, 1.8, vSoftness)` for
  glow falloff and `mix(0.48, 0.38, vSoftness)` for disc edge AA in
  `star.frag.glsl`. Widen the gaps for more dramatic differentiation.
- **Info-modal dismissal** — cleared by removing the
  `stellata.info-dismissed` localStorage key.
- **Chart-mode disc size range** — `uChartDiscMaxPx` (16 px) and
  `uChartDiscMinPx` (1.5 px) defaults set in the shared-uniforms map
  in `stellata.ts`; spread linearly across the visible magnitude
  range. `uChartMagBright` (−2.0) is the magnitude that maps to MAX.
- **Constellation-boundary stipple** — `BOUNDARY_DOT_PX` (1.5 px) /
  `BOUNDARY_GAP_PX` (3 px) in `constellation-boundary-layer.ts`, the Sky
  Atlas 2000.0 dotted rule. Screen pixels, not degrees of sky — the dots hold
  their size through zoom. `BOUNDARY_OPACITY` (0.5) is the weight it shares
  with the solid coordinate grid.
- **Variable-ring gap** — `VARIABLE_RING_MIN_GAP_PX` (1.0 px) in
  `chart-labels.ts`. Minimum radial gap between the outer ring and
  the peak inner disc; raise if low-amplitude variables look
  cluttered.
- **Binary-wing extension** — `BINARY_WING_EXTENSION_PX` (4 px) in
  `chart-labels.ts`. Length past each disc edge.
- **Star-name label offset** — `STAR_LABEL_OFFSET_PX` (9 px) in
  `chart-labels.ts`. Distance from the disc centre to the label
  anchor, applied as `(x + offset, y - offset)` for a top-right read.
- **Pick hit-radius floor** — `MIN_DISC_HIT_RADIUS_PX` (4 px) in
  `star-geometry.ts`, consumed by `Picker.pickStar`. Floor on the
  prime-disc hit test so
  tiny chart-mode discs stay hoverable. Raise for easier hover at the
  cost of more cases where a neighbour disc whose centre is
  marginally closer to the cursor wins over the visually-targeted
  star (`pickScore` tiebreak — see `star-geometry.ts`).
- **Pick magnitude bias** — `PICK_MAG_BIAS_PX_PER_MAG` (0.05 px/mag)
  in `star-geometry.ts`. Sub-pixel weight on `appMag` in `pickScore`
  so two coincident catalog rows (e.g. Alula Australis A/B) tiebreak
  to the brighter component without disturbing the screen-pixel
  proximity ordering for any visible separation.
- **Panel collapse default** — persisted under `stellata.panel-collapsed`
  (`'0'` = expanded, `'1'` = collapsed, missing = collapsed by default for
  first-time visitors). The default-collapsed check is phrased as
  `!== '0'` in `panel-layout.ts` so absence of the key means collapsed.
