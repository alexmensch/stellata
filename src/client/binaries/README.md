# src/client/binaries/ — multi-star runtime layer

Runtime support for binary / multiple-star systems. The loader here
parses `public/binaries.bin` (written by
`scripts/binaries/build-runtime-binaries.py`) into a typed record-set
that `BinaryOrbitField` walks per frame to apply orbital motion to
star catalog records.

## Files

- `binaries-loader.ts` — parses the v1 `BIN1` binary format into a
  `BinariesData` struct: per-pair Kepler elements + `sep_arcsec` /
  `pa_deg` for the static-placement fallback, plus index maps
  (`primaryIdxToRelations`, `secondaryIdxToRelation`) for runtime
  lookups. Round-trip + fail-mode coverage in `binaries-loader.test.ts`.
- `binary-orbit-pure.ts` — Kepler / Thiele-Innes math. Tier 1 path
  (`evaluateOrbitSkyAU` + `projectSkyToICRS`) produces the full 3D
  offset — sky tangent (north, east) plus the line-of-sight radial
  component `Z = r·sin(ν+ω)·sin i` — so orbits have real depth from
  any camera vantage. Tier 2 galactic-plane fallback
  (`evaluateOrbitInPlaneAU` + `projectGalacticPlaneToICRS`). No state.
- `orbit-relation-cache.ts` — shared per-attach cache builder
  (`buildOrbitRelationCaches`: has_orbit + finite-elements gates, tier,
  elements, baseline `R(sep_pa_epoch_jd)`) and the per-frame
  `evaluateOrbitRelationDeltaPc` dispatch. Both fields below consume it.
- `binary-orbit-field.ts` — per-frame position field. `update(t,
  camera, …)` walks `BinariesData.relations` in topological order,
  applies the LOD cascade described below, and rewrites the active
  slots of `localPositions` plus `compositeSuppress`.
  `recenter(newOrigin)` updates the cached world offset.
- `binary-tuning.ts` — `VISIBILITY_HORIZON_PC`, `SUB_PIXEL_THRESHOLD_PX`,
  `ECLIPSE_DIM_TAU_S` named constants the fields read and tests pin.
- `eclipse-photometry-pure.ts` — pure math for camera-anywhere
  geometric occlusion: `eclipseDimFromOffsets` (angular separation via
  atan2 of unit view vectors, closed-form circle-circle lens area,
  geometric dim factor on the back component's flux) and
  `orbitPlaneNormalICRS` (the view-direction prefilter's normal,
  sampled from the same eval path the renderer uses).
  `eclipse-photometry-pure.test.ts` pins the degenerate cases and the
  float32-line-of-sight immunity.
- `eclipse-photometry.ts` — per-frame field over the same relation
  caches. Evaluates each pair's offset in float64 and writes
  per-instance `iEclipseDim` for the back component when discs
  overlap. Runs AFTER `BinaryOrbitField` in the per-frame loop. See
  § Eclipse photometry.

## Format contract

The v1 wire format is the single contract between the Python writer
(`scripts/binaries/build-runtime-binaries.py`) and this loader:

- Header (16 B): `BIN1` magic + uint32 version + uint32 count + 4 B
  reserved.
- Record (72 B): see `RECORD_LAYOUT` in `binaries-loader.ts` for the
  per-field byte offsets. Float64 fields land on 8-byte boundaries.
  Trailing 8 bytes are reserved for forward-compat.

Flag bits on each record (`flags` uint32):
- `0x1` has_orbit — every element BinaryOrbitField consumes is finite:
  P, T, e, a, ω, q. (Ω is optional — `relationToElements` falls back
  to 0 when absent; only Tier 1 reads it.) `build-runtime-binaries.py`
  refuses to set this bit when any required element is `None`, so a
  pair surfacing this flag is guaranteed Kepler-evaluable.
- `0x2` has_inclination — inclination i_rad is valid (Tier-1 canonical
  Kepler). When unset, runtime uses the galactic-Z fallback orbit normal
  (Tier 2).
- `0x4` is_inner_of_hierarchy — pair sits inside another pair (Algol
  Aa1,Aa2 inside Aa,Ab). `parentRelation` then points at the outer
  pair's record index.

Records are walked in topological (outer-before-inner) order, so a
single forward pass through `relations` is enough for the runtime to
evaluate parents before children.

## Tier mapping

The runtime layer reads this artifact under three tier rules (set by
the per-pair flags):

- **Tier 1** (`has_orbit & has_inclination`) — full Kepler +
  Thiele-Innes + sky→ICRS projection. The separation
  `(north, east, radial) AU` at time t projects through the system's
  ICRS (α, δ) tangent basis (radial along the Sol→system direction) to
  ICRS Δxyz. R at the stored sep+PA epoch (`sep_pa_epoch_jd`; J2000
  fallback when the record carries none) is cached per relation both as
  the ΔR baseline and — projected to a float64 ICRS pc vector — as
  `baseDiffPc`, so each frame is one Kepler solve + one add. Pure-visual
  ORB6 orbits carry a ±180° ascending-node ambiguity — the radial
  component's SIGN (which member is nearer at conjunction) follows the
  published node's convention, not an observation.

  **Rendered relative offset = R(t), from the elements alone.** Both
  consumers place the pair's relative offset at `baseDiffPc + ΔR(t)` =
  `R(epoch) + (R(t) − R(epoch))` = `R(t)` exactly. It is never a
  subtraction of two float32 catalog slots: that difference carries any
  WDS/Kepler placement disagreement — interferometric quadrant
  ambiguity, or the tangent-only WDS bake's missing radial term — into
  the rendered orbit centre, and float32-quantises to grid noise for
  tight pairs. That was the displaced-centre bug: the companion orbited
  an empty point and could sweep through the primary once per period
  (Alsephina Ab at 0.562 AU vs apoapsis 0.52 AU). The baked catalog
  position is now purely a static record + the LOD fallback (§
  Walk-active LOD). Sub-resolution pairs (WDS ρ 0.000 / unmeasured)
  collocate bit-identically on the primary — a placement choice for the
  fallback, not a runtime signal; they render R(t) around the primary
  like every other pair, no special baseline path.
- **Tier 2** (`has_orbit & !has_inclination`) — Kepler eval with the
  orbit normal forced to the galactic Z axis. The in-plane (x, y) AU
  position rides directly into the galactic XY basis, which
  `GAL_TO_ICRS` then rotates into ICRS Δxyz.
- **Tier 3** (`!has_orbit`) — no per-frame Kepler eval. The companion's
  static placement is already baked into `catalog.bin` by the
  build-time companion-promotion pass (see
  `scripts/catalog/companion-promotion.ts`), so the runtime layer can
  skip these records entirely.

For Tier 1 and Tier 2 the offset is split q : (1−q) between primary
and secondary about the system barycentre — primary moves by
`−q·ΔR(t)`, secondary by `+(1−q)·ΔR(t)`, where q = M_s/(M_p + M_s) is
the mass-fraction stored on each record.

### Focal-frame ride (no rebase)

The walk applies the barycentric split in EVERY regime — there is no
focal rebase. Focusing a pair member writes byte-identical positions to
being unfocused, so focus→unfocus is a pure state change with no
position discontinuity. Instead of rebasing the focal to the local
origin to match the disc shader's `uPinFocusToCenter`, the **camera
rides the focal star's perturbed position**: the integration shell
(`stellata.ts`, `applyFocalFrameRide`) translates `camera.position` +
`controls.target` (and any in-flight camera-transition pose caches) by
the focal's per-frame orbital drift, so `controls.target` stays glued to
the star and `lookAt(target) == star` keeps the pin substitution valid.

`focalPerturbationInto(focalIdx, t, out)` supplies that drift in
**float64**: it replays the focal's slot-chain (§ Walk-active LOD) in
double precision and returns the focal's total displacement from its
catalog baseline — matching the walk's float32-written slot within the
position quantum, continuous in `t`. `setFocus` reads it to snap
`controls.target` onto the star's live position; a per-frame delta then
drives the ride. On the frame the focal changes, the ride re-snaps
`controls.target` onto the star's **live `_localPositions` slot** rather
than trusting that focus-entry snap — under fast scrub sim-time advances
between the focus event and the next frame, so the event-time sample goes
stale and would leave the star a fixed offset off-centre. The pure step
math is `focal-ride-pure.ts:focalRideStep`. CPU consumers (focus ring,
distance vector, HUD shafts, hover picker) read the perturbed
`_localPositions` and project through the same `lookAt(target)` camera,
so they land on the disc without any rebase. The ride is skipped during
warp (the warp owns the camera and tracks the live buffer itself).

## Walk-active LOD

Two filters on top of the magnitude slider gate per-frame Kepler
evaluation:

1. Primary's apparent magnitude vs slider (`maxAppMag + 0.5` matches
   the star shader's soft-taper kill condition).
2. Primary's camera distance vs `VISIBILITY_HORIZON_PC` (= 1000 pc).
   Past that the orbit subtends a fraction of a milliarcsecond even
   for wide-separation pairs.

Beyond that, the screen-separation gate fires before Kepler runs:

3. Peak angular separation `a·(1+e)/d_cam_pc · ARCSEC_TO_RAD · pxPerRad`.
   When the worst-case peak is below `SUB_PIXEL_THRESHOLD_PX` (= 1.5 px)
   the relation skips Kepler entirely and sets
   `iCompositeSuppress[secondaryIdx] = 1`. The star shader's existing
   off-screen-sentinel block then collapses the disc (mode 1) and core
   depth-mask (mode 2) passes for that instance; the additive glow
   pass (mode 0) still runs so the two near-coincident point sources
   sum brightness correctly under AdditiveBlending.

   The gate still writes the secondary's slot — it collapses onto the
   primary's CURRENT position plus `baseDiffPc`
   (`local[pBase] + baseDiffPc`), dropping only the orbital `ΔR`. This is
   the SAME anchor the active walk uses, so crossing the gate never steps
   the secondary by `baseDiffPc − bakedDiff` — the drop is just `ΔR`,
   itself sub-pixel by the gate's own test. Anchoring on the baked slot
   diff instead would reintroduce a `baseDiffPc − bakedDiff` snap for the
   pairs whose baked placement disagrees with `R(epoch)` (the very
   population this layer renders elements-alone to avoid). This also
   matters for a **hierarchical inner pair**: the shared primary slot
   already carries the parent pair's `−q_outer·ΔR_outer`, so the inner
   secondary must inherit it. Leaving the secondary at its raw reset
   baseline (as the gate once did) detached it from the parent-perturbed
   primary by `q_outer·ΔR_outer` — an AU-scale, super-pixel snap when the
   tight inner pair crossed the gate on zoom-out (Algol Aa2 at ~60-75 AU).

   Relations on the **focal star's slot-chain** are EXEMPT from ALL
   THREE gates (horizon, magnitude, sub-pixel). The chain is every
   relation that writes the focal's slot — focal as primary or secondary
   — plus their `parentRelation` ancestors (precomputed when `focalIdx`
   changes). Their ΔR feeds the focal-frame ride, so it must stay
   continuous in `t`: a gate firing mid-focus would snap the focal to its
   baseline and jolt the camera (the old hard switch step-jumped the
   partner at a per-system camera distance on zoom-out — ~75 AU for
   Algol's tight pair, ~800 AU for Capella's). A ≤3-relation chain's
   Kepler solves are cheap. Non-chain relations gate freely — they can't
   touch the focal's slot.

## Hierarchical walk

Inner pairs (Algol Aa1↔Aa2 inside Aa↔Ab) walk after their parent in
topological order. Each relation reads the primary's CURRENT
`localPositions` slot as the anchor — for a hierarchical inner pair
that anchor already carries the parent pair's `−q·ΔR_outer`
perturbation. The secondary slot then takes
`local[pBase] + baseDiffPc + ΔR` so the secondary inherits the SAME
parent perturbation the primary carries; the inner pair's relative
offset stays clean of the parent. (`sCoeff − pCoeff =
1` — one formula, one regime — the barycentric split, with no focal
special-case.)

`focalPerturbationInto` reconstructs a hierarchical focal's float64
displacement the same way: it walks the focal's chain (the writing
relation plus its `parentRelation` ancestors) in topological order,
accumulating `−q·ΔR` onto each primary slot and assigning
`primary + ΔR + (baseDiffPc − bakedDiff)` to each secondary. The trailing
`corr = baseDiffPc − bakedDiff` is the elements-alone anchor shifting the
secondary off its baked placement — for Algol's collocated Aa2 that is
the full `baseDiffPc_inner`. It is the same value the walk writes into
the buffer (the walk anchors the secondary on `baseDiffPc` too), so the
ride tracks the true perturbed position; without `corr` the ride would
leave `controls.target` off a focused secondary of a mismatched pair by
that constant, silently disengaging the pin (§ focus/README).

## Eclipse photometry

`EclipsePhotometryField` runs after `BinaryOrbitField` each frame
and writes a per-instance dim multiplier on the back component's
flux whenever discs overlap from the camera's viewpoint. The math
is camera-anywhere by construction — EA/EB/EW labels are Earth's-
viewpoint facts; any system can eclipse from any viewpoint when its
geometry aligns. Each pair's offset is evaluated per frame in
**float64** as `baseDiffPc + ΔR(t) = R(t)` (the elements-alone epoch
baseline plus the orbital delta — exactly the offset the position walk
renders: the barycentric split and hierarchical anchor both preserve
`sCoeff − pCoeff = 1`). The pure helper decomposes that
offset against the camera→primary line of sight, computes each
disc's angular radius, and runs the closed-form circle-circle lens
area; the dim is `1 − occluded_area / back_disc_area`.

**Never derive pair geometry from `localPositions`** — the float32
position quantum is `d_origin · 2⁻²³` (≈0.6 AU for a star 25 pc from
the local origin), larger than most orbital separations, so a
subtraction of two buffer positions reads pure grid noise where the
eclipse test needs nano-radian resolution. The buffer is only read
for the line of sight, whose float32 error cancels between the two
unit view vectors.

The Kepler eval here is deliberately NOT gated on the orbit walk's
screen-pixel LOD: the photometric dip is exactly the signal that
remains when the pair is sub-pixel. Instead each relation carries a
**view-direction prefilter** — the rendered offset always lies in
the orbit plane, so lines of sight steeper against that plane than
`(r_pri + r_sec) / min_rendered_separation` can never eclipse and
skip the Kepler solve (the vast majority of (camera, pair)
combinations each frame). The rendered offset is `R(t)` exactly, so its
minimum over a period is closed-form periapsis `a(1−e)` — no sampling.

Surface-brightness ratios stay implicit: each star is its own
instance with its own absmag, and dimming the back's flux by the
geometric area fraction gives the right composite when the two
sum additively in the glow pass. Limb darkening is not modelled
(uniform disc surface brightness).

### Anti-strobe smoothing

Under heavy time-warp an eclipse can last less than a frame; raw
per-frame geometry would strobe the composite at frame rate. Written
dims blend toward each frame's geometric target with time constant
`ECLIPSE_DIM_TAU_S` (real seconds — a render filter, not sim time),
so sub-frame events read as a soft shimmer while real-time dips
(hours long) pass through visually untouched. Slots decay back to
exactly 1.0 after occlusion ends and leave the field's active set;
frames that write nothing skip the attribute re-upload entirely.

### Shader-side wiring

`iEclipseDim` is folded into appMag in the **glow pass only**
(`uRenderMode == 0`). The disc pass resolves geometric occlusion
via the depth buffer at close range (real depth separation now that
Tier-1 orbits carry the radial component), so applying the dim there
would also dim the back disc's non-occluded fragments. The
integration shell initialises the buffer to 1.0 at allocation
and on every re-attach.

`eclipse-photometry-pure` floors its return value at
`DIM_FLOOR = 0.001` rather than 0 so `-2.5·log10(dim)` stays
finite for a full geometric eclipse. 7.5 mag of dim reads as
effectively invisible in the additive glow composite — the
floor is a numeric-domain guard, not a sentinel encoding.

### Pulsation gate for eclipsing binaries

`iSuppressPulsation` is a per-instance flag built once at
catalog-load time from `catalog.varType` alone: 1.0 on every
record whose GCVS variability type is `VAR_TYPE_ECLIPSING`,
independent of the binaries data. Eclipsers are extrinsically
variable — the brightness dip is a line-of-sight occlusion, not
the star's own output — so the GCVS-amplitude radial pulsation is
always a fabrication and is gated off unconditionally.

For an EA/EB/EW primary WITH orbital elements, the honest signal
comes from `EclipsePhotometryField`'s geometric dip. For one with
NO elements (no NSS or ORB6 entry) there is no phase to animate, so
the star simply renders static — we don't invent a pulsation cycle
we can't derive.

`star-physics.ts`'s `renderedSizePx` reads the same suppress mask
(via the optional `suppressPulsation` arg) so the SVG focus ring +
disc mask + distance-vector tip track the rendered (un-modulated)
disc on suppressed primaries.
