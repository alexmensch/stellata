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
  (`primaryIdxToRelations`, `secondaryIdxToRelations` — both
  one-to-many; a star can be the measured secondary of several
  primaries, e.g. α Cru C off both A and B) for runtime lookups.
  Round-trip + fail-mode coverage in `binaries-loader.test.ts`.
- `binary-orbit-pure.ts` — Kepler / Thiele-Innes math. Tier 1 path
  (`evaluateOrbitSkyAU` + `projectSkyToICRS`) produces the full 3D
  offset — sky tangent (north, east) plus the line-of-sight radial
  component `Z = r·sin(ν+ω)·sin i` — so orbits have real depth from
  any camera vantage. Tier 2 galactic-plane fallback
  (`evaluateOrbitInPlaneAU` + `projectGalacticPlaneToICRS`). No state.
- `orbit-relation-cache.ts` — `keplerRelationParams` (the has_orbit +
  finite-elements gate → tier + elements, shared with the orbit-path
  layer), the per-attach cache builder (`buildOrbitRelationCaches`:
  adds baseline `R(sep_pa_epoch_jd)`), and the per-frame
  `evaluateOrbitRelationDeltaPc` dispatch. Both runtime fields consume it.
- `binary-orbit-field.ts` — per-frame position field. `update(t,
  camera, …)` walks `BinariesData.relations` in topological order,
  applies the LOD cascade described below, and rewrites the active
  slots of `localPositions` plus `compositeSuppress`.
  `recenter(newOrigin)` updates the cached world offset.
  **Static-frame skip:** when the previous `update()` evaluated zero
  Kepler relations (everything gated out or sub-pixel-suppressed —
  the shipping idle state at any wide view), every buffer write is a
  pure function of (camera, slider, viewport, fov, focal), so an
  `update()` with identical inputs skips the walk AND both
  `needsUpdate` flags — without it three.js re-uploads the full
  ~5 MB backing arrays every idle frame. Focal-chain relations are
  always Kepler-active (they bypass the gates), so a focused orbit
  never skips. `recenter()` and `markBaselinesDirty()` (called by the
  shell whenever it rewrites `localPositions` wholesale — epoch
  re-advance, origin recentre) force the next walk so suppressed
  secondaries get their `baseDiffPc` placement re-applied on top of
  the fresh baselines.
- `focal-chain.ts` — `focalChainRelationSet(binaries, focalIdx)`: the
  relation-index set on a focal star's slot-chain (focal as primary or
  secondary, plus `parentRelation` ancestors). Shared by
  `BinaryOrbitField`'s LOD-exemption walk and the orbit-path layer.
- `binary-orbit-path-pure.ts` — `keplerChainRelationIdxs` (the focal
  chain filtered to `has_orbit` pairs) + `buildBinaryOrbitRingPoints`
  (one pair sampled into the two members' barycentric ellipses). See
  § Binary orbit paths.
- `binary-orbit-path-layer.ts` — `BinaryOrbitPathLayer`, the orbit-path
  render layer. See § Binary orbit paths.
- `binary-relation-fixture.ts` — `makeRelation(overrides)`, the shared
  `BinaryRelation` test builder.
- `binary-tuning.ts` — `VISIBILITY_HORIZON_PC`, `SUB_PIXEL_THRESHOLD_PX`,
  `ECLIPSE_DIM_TAU_S`, `DISC_DEPTH_BIAS` named constants the fields read
  and tests pin.
- `eclipse-photometry-pure.ts` — pure math for camera-anywhere
  geometric occlusion: `eclipseDimFromOffsets` (angular separation via
  atan2 of unit view vectors, closed-form circle-circle lens area,
  geometric dim factor on the back component's flux),
  `orbitPlaneNormalICRS` (the view-direction prefilter's normal,
  sampled from the same eval path the renderer uses), and the shared
  anti-strobe helpers `dimBlendFactor` + `blendDimBuffer` (+
  `DIM_SETTLED`). Second consumer: the planet field's true-eclipse
  dim (`solar-system/README.md` § Planet rendering) reuses all of
  these for planet-behind-host-disc occlusion.
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

### Composition with proper-motion propagation

The epoch-advance (`loaders/epoch-advance-pure.ts`) shifts
`catalog.positions` by each star's baked space-motion velocity *before*
`BinaryOrbitField` runs, so the pair's systemic drift is already in the
primary slot this field reads. That ordering holds per frame under time
scrubbing too: `maybeReAdvanceEpoch` runs at the top of `animate()`,
rewriting `catalog.positions` + `_localPositions` off the immutable
J2016.0 baseline, and this field's walk then re-perturbs its active
slots on top of the fresh baselines in the same frame. Unfocused, that
slot-reset baseline is reconstructed in float64 off the J2016.0 baseline
+ velocities rather than read from the float32 `catalog.positions`
(§ Walk-active LOD). When a star is focused every relation instead resets
from `catalog.positions`, so the whole scene rides the same absolute the
shell's epoch-follow moves the camera by (`focalPerturbationInto`'s
`bakedDiff` also reads the live `catalog.positions`) — the two cancel and
the focal stays pinned. The systemic-velocity invariant keeps every
`has_orbit` pair's baked diff constant under the advance, so no cache here
is epoch-keyed. (The one deliberate exception: `baseDiffPc`'s ICRS
tangent basis is built from the primary's attach-time direction — stale
by sub-milliarcseconds over the full scrub range, orders below the
elements' own uncertainty.) Because the walk places a Tier-1/2 secondary
at `primary + baseDiffPc + ΔR(t)` from the **elements alone** (never
`abs[s] − abs[p]`), the rendered relative offset is invariant under the
advance regardless of the members' baked velocities — orbital motion stays
owned by this Kepler layer with no double-counting. The velocity coherence
therefore matters only for **Tier-3 static** companions (skipped here): they
ride their baked velocity directly, so a promoted companion with no own PM
inherits its primary's systemic velocity at build time
(`scripts/catalog/companion-promotion.ts`) or it would freeze at `v=0` and
shear from a drifting primary. Full systemic coherence for *every*
binaries.bin pair — keyed on this file's authoritative resolved pairing,
which the catalog build can't replicate — is `stellata-zau1`; until it
lands, the ~950 divergent-velocity Tier-3 wide pairs shear up to tens of
arcminutes at the scrub-range extremes (SCIENCE.md § Current-epoch star
positions).

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
stale and would leave the star a fixed offset off-centre. That re-snap
is suppressed in observe mode: there `controls.target` is the
look-direction pin one parsec ahead of the camera (not on the star),
and re-snapping against it would drag the star-parked camera a parsec
off the focal — the cold-load observe URL-restore bug. The pure step
math is `focal-ride-pure.ts:focalRideStep`. CPU consumers (focus ring,
distance vector, HUD shafts, hover picker) read the perturbed
`_localPositions` and project through the same `lookAt(target)` camera,
so they land on the disc without any rebase. The ride is skipped during
warp (the warp owns the camera and tracks the live buffer itself).

**Origin-follow (drift recentre).** The ride translates the camera to
follow the focal, so under fast scrub a far-orbiting focal (a planet
across its orbit; a wide binary) drags the camera tens of AU from the
fixed focus-time origin — reviving the float32 modelview cancellation
the floating origin exists to prevent (a growing wobble on the focal
body). `stellata.ts:maybeRecenterOnFocalDrift` recentres the origin
back onto the look target once camera-from-origin exceeds
`FOCAL_ORIGIN_DRIFT_RATIO × eye distance` (`focal-ride-pure.ts`),
restoring camera-from-origin ≈ eye distance. It is kind-agnostic —
keyed on camera geometry, not the focus kind — so every hard focus
benefits with no per-kind code. The shared origin is the one precision
lever a per-shader pin (`uPinFocusToCenter`) can't generalise; that pin
still handles the separate close-approach-at-origin case (§ focus/README
§ Pin-to-center).

## Walk-active LOD

Each frame the walk first resets every relation's primary + secondary
local slots to their unperturbed systemic baseline (then the passes
below ADD orbital perturbation on top). **Unfocused** that reset is
`(base + v·Δt) − worldOffset` computed in float64 (`writeAdvancedLocal`
off the immutable J2016.0 baseline + velocities), NOT `catalog.positions
− worldOffset`: the float32 absolute ULP is ~0.4 AU at 28 pc, so the
rounded-absolute path snaps a drifting system onto that grid under time
scrub (the reported unfocused-system teleport). **When a star is focused**
every relation resets from `catalog.positions` instead — see § Composition
with proper-motion propagation for why the whole focused scene must ride
the absolute.

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

## Binary orbit paths

`BinaryOrbitPathLayer` (`binary-orbit-path-layer.ts`) traces the actual
orbital path each member of the **focused** multi-star system sweeps — a
`representational`-tier declutter element (`binaryOrbitRings`,
`scene/README.md`), realistic-only. Focus-gated by design:
representational annotations hide on unfocus, so only the focused star's
system draws, never every catalog pair.

- **Which pairs** come from `keplerChainRelationIdxs` = the focal chain
  (`focal-chain.ts`) filtered to `has_orbit` relations. Visual companions
  (Tier 3, no Kepler elements) are excluded — there is no orbit to draw,
  so a wide optical double shows nothing. The chain is exactly the set
  `BinaryOrbitField` holds LOD-exempt, so both members stay live.
- **Barycentric two-ellipse convention.** Each pair draws two ellipses
  about the common barycentre — the physically honest "actual paths",
  not the primary-fixed apparent-orbit plot. `buildBinaryOrbitRingPoints`
  samples `evaluateOrbitOffsetPc` over one period and splits it `−q` :
  `+(1−q)` (the same mass fraction the orbit walk applies), so the more
  massive member traces the smaller ellipse, the two sit 180° apart, and
  the barycentre lands at each ellipse's focus. The stars sit *on* their
  own paths: the sampled vertex at the live phase equals the walk's
  rendered offset.
- **Anchor.** Ellipse vertices are ICRS pc *offsets* from the
  barycentre (frame-independent), built once per focus change. Per frame
  `update` only repositions each pair's group at its live barycentre
  `(1−q)·primary + q·secondary`, read from the walked `localPositions`
  right after the orbit walk. Hierarchical inner pairs anchor on their
  parent-perturbed slots, so an inner ellipse rides the outer orbit —
  the honest epicyclic decomposition, one ellipse-pair per relation.
- **Tier 2** (`has_orbit`, no measured inclination) draws too: period
  and semi-major axis are real, but the orbit plane is the galactic-Z
  fallback, so the ellipse *orientation* is not physical — size and
  timing are.
- **Render order** `−0.5`: below the star discs (`0`) so a disc
  composites over the path where a member sits on it, above the galactic
  disc/grid (`−1`). Constellation figures are SVG (always above the WebGL
  canvas), so the path cannot sit over them.
- Geometry rebuilds on focus change (`setSystem`), mirroring
  `OrbitRingsLayer.setPlanetSystem`; the per-frame `update` moves
  barycentre anchors and applies the size gate below. The two loops per
  pair share one alpha-blended material built by `util/orbit-line.ts`
  (`makeOrbitLineLoop` / `makeOrbitLineMaterial` + shared
  `ORBIT_LINE_SEGMENTS`) — the same primitive the planet orbit rings use.
- **On-screen-size gate.** `update` hides a pair once its larger ellipse
  subtends less than `PATH_MIN_RADIUS_PX` (`pixelsPerRadian` /
  `angularRadiusPx` from `util/orbit-line.ts`), so a distant or zoomed-out
  system stops drawing sub-pixel loops — the analog of the planet rings'
  pixel gate (an absolute per-pair threshold, not `ringVisibility`'s
  neighbour-gap, which degenerates for a lone or equal-mass pair).
- **Focus-ring suppression.** `anyOrbitRingVisible()` (the sibling name
  `OrbitRingsLayer` carries) reports true only while a pair is drawn AND
  above that size gate; `Stellata.anyOrbitRingVisible` ORs it with the
  planet rings, and the focus-ring overlay hides itself when either is up —
  the drawn orbit already marks the focal star, so the ring would read as a
  spurious inner orbital. Zoom out until the paths fall below the gate and
  the focus ring returns (`../overlays/README.md`).

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
`discSum / min_separation` can never bring the discs into overlap and
skip the Kepler solve (the vast majority of (camera, pair)
combinations each frame). The minimum separation is closed-form
periapsis `a(1−e)` — the rendered offset is `R(t)` exactly, no
sampling. `discSum` is inflated to the **rendered** disc-sum bound
(`(r_pri + r_sec) × RENDERED_DISC_SINLIMIT_MARGIN`, the disc-pass 2×
cap) so the prefilter can't cull a pair whose rendered discs overlap
and z-fight while the physical discs just miss — the exact gate that
was silently dropping the depth-bias write.

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
(`uRenderMode == 0`) — applying the dim in the disc pass would also
dim the back disc's non-occluded fragments. The integration shell
initialises the buffer to 1.0 at allocation and on every re-attach.

The disc pass instead orders the two overlapping cores through the
depth buffer — but at close range the log-depth buffer can't resolve a
tight pair's sub-AU line-of-sight separation (`log2(z+1)` is
near-linear when `z ≪ 1 pc`; see `star-pipeline/README.md`
§ Depth encoding), so the raw z-order is float noise that flickers
frame-to-frame. Whenever the two **rendered** discs overlap, the field
writes `DISC_DEPTH_BIAS` (`binary-tuning.ts`) into the shared
`iDepthBias` attribute on the **back** component — the float64 `front`
verdict, not the buffer, decides the order.

The bias trigger is deliberately NOT the `dim < 1` occlusion condition.
`dim` keys off the **physical** disc radii (true angular size), but the
z-fight happens over the **rendered** footprint: a bright star's
brightness-driven `appSize` term inflates its disc past its true
angular radius, so the opaque cores overlap — and flicker — across an
annulus where `dim` is still 1. The bias therefore fires when
`θ < renderedRadius_pri + renderedRadius_sec`, the rendered angular
radii supplied per frame by the integration shell via
`star-physics.ts:renderedSizePx` (the same CPU mirror the focus
ring/disc mask trust). This set is a superset of the dimmed set. The
`front` verdict is valid across this whole annulus — `eclipse-photometry-pure`
computes it before the physical-overlap test.

The bias is a hard per-frame verdict with no smoothing: it resets to 0
the frame the overlap ends (unlike the anti-strobe-smoothed dim). The
field owns `iDepthBias` exclusively, so it clears its own prior-frame
entries rather than relying on `BinaryOrbitField`'s reset (which only
touches `compositeSuppress`).

`eclipse-photometry-pure` floors PARTIAL dims at `DIM_FLOOR = 0.001`
(a numeric-domain guard so `-2.5·log10(dim)` stays finite as overlap
approaches totality) but returns **exactly 0 for a full geometric
eclipse**, and both glow shaders collapse the quad at 0 (the star
pipeline's off-screen-sentinel pattern). A floored +7.5 mag residual
is invisible for typical binary flux levels but NOT for a bright
close-range back body — Mercury (mag ≈ −1) behind Sol's disc stayed a
visible glow point — and the depth buffer can't hide it either (the
pair's line-of-sight separation sits inside one log-depth bucket).
`blendDimBuffer` snaps a decaying totality slot to exact 0 once it
drops below the floor, since the exponential smoothing alone never
reaches the shader's `<= 0` gate.

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
