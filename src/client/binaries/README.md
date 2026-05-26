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
- `binary-orbit-pure.ts` — Kepler / Thiele-Innes / tangent-plane math.
  Tier 1 path (`evaluateOrbitSkyAU` + `projectSkyToICRS`) and Tier 2
  galactic-plane fallback (`evaluateOrbitInPlaneAU` +
  `projectGalacticPlaneToICRS`). No state — `binary-orbit-field.ts`
  owns the per-attach J2000 cache.
- `binary-orbit-field.ts` — per-frame field. Constructor caches one
  `RelationCache` per `has_orbit` relation (with `R(J2000)` baked in
  per tier). `update(t, camera, …)` walks `BinariesData.relations` in
  topological order, applies the LOD cascade described below, and
  rewrites the active slots of `localPositions` plus
  `compositeSuppress`. `recenter(newOrigin)` updates the cached world
  offset.
- `binary-tuning.ts` — `VISIBILITY_HORIZON_PC` + `SUB_PIXEL_THRESHOLD_PX`
  named constants the field reads each frame and tests pin.
- `eclipse-photometry-pure.ts` — pure math for camera-anywhere
  geometric occlusion: image-plane angular projection, closed-form
  circle-circle lens area, geometric dim factor on the back
  component's flux. `eclipse-photometry-pure.test.ts` pins the
  degenerate cases.
- `eclipse-photometry.ts` — per-frame field that walks the same
  has_orbit relations the orbit field does, reads the
  post-perturbation `localPositions`, and writes per-instance
  `iEclipseDim` for the back component when discs overlap. Runs
  AFTER `BinaryOrbitField` in the per-frame loop (it consumes the
  orbit field's outputs). See § Eclipse photometry.

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
  Thiele-Innes + sky→ICRS tangent-plane projection. The sky-plane
  separation `(north, east) AU` at time t projects through the system's
  ICRS (α, δ) tangent basis to ICRS Δxyz. R(J2000) is cached per
  relation so each frame is one Kepler solve + one subtract.
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

### Focal-star rebase

When the focal star is a member of the pair (primary or secondary),
the split rebases so the focal stays at the local origin and the
companion carries the FULL relative motion `ΔR(t)`. The disc shader's
`uPinFocusToCenter` pins the focused instance to NDC (0,0)
regardless of `iPosition`; without the rebase, `_localPositions[focal]`
drifts to a non-zero perturbation while the GPU keeps the disc at
screen centre, and every CPU consumer (focus ring, distance vector,
HUD shafts, hover picker) projects to a point separated from where
the disc actually renders. Coefficients applied in the walk loop:

- focal = primary: `pCoeff = 0`, `sCoeff = 1`.
- focal = secondary: `pCoeff = -1`, `sCoeff = 0`.
- focal not in pair: `pCoeff = -q`, `sCoeff = 1-q` (barycentric).

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

## Hierarchical walk

Inner pairs (Algol Aa1↔Aa2 inside Aa↔Ab) walk after their parent in
topological order. Each relation reads the primary's CURRENT
`localPositions` slot as the anchor — for a hierarchical inner pair
that anchor already carries the parent pair's `−q·ΔR_outer`
perturbation. The secondary slot then takes
`local[pBase] + (abs[sBase] − abs[pBase]) + ΔR` so the secondary
inherits the SAME parent perturbation the primary carries; the inner
pair's relative offset stays clean of the parent. (`sCoeff − pCoeff =
1` in every regime — focal-pin or barycentric split — so a single
formula covers both.)

When the focal star IS the inner-pair secondary (focal=sIdx), the
walk uses the absolute baseline instead of the current local[pBase]
so the focal-pin re-centres on the inner pair's orbital frame and
absorbs the parent's barycentric shift. The inner pair physically
moves rigidly under the outer barycentre, and pinning on the inner
secondary reflects that: from Aa2's viewpoint, Aa1 sits at −ΔR_inner
regardless of outer phase. Without this branch the parent's
perturbation on Aa1 would leak into the displacement as a
parent-period oscillation of ~q_outer·a_outer in magnitude (~1 AU for
Algol's Aa↔Ab; 18× the inner-pair semi-major).

## Eclipse photometry

`EclipsePhotometryField` runs after `BinaryOrbitField` each frame
and writes a per-instance dim multiplier on the back component's
flux whenever discs overlap from the camera's viewpoint. The math
is camera-anywhere by construction — EA/EB/EW labels are Earth's-
viewpoint facts; any system can eclipse from any viewpoint when its
geometry aligns. The pure helper decomposes the 3D separation onto
the camera→primary line of sight, computes each disc's angular
radius, and runs the closed-form circle-circle lens area; the dim
is `1 − occluded_area / back_disc_area`.

Surface-brightness ratios stay implicit: each star is its own
instance with its own absmag, and dimming the back's flux by the
geometric area fraction gives the right composite when the two
sum additively in the glow pass. Limb darkening is not modelled
(uniform disc surface brightness).

### Shader-side wiring

`iEclipseDim` is folded into appMag in the **glow pass only**
(`uRenderMode == 0`). The disc pass resolves geometric occlusion
via the depth buffer at close range, so applying the dim there
would also dim the back disc's non-occluded fragments. Default
value is 1.0 (no dim); the field writes lower values onto the
back component each frame and resets touched-last-frame slots so
transient occlusions clear.

The attribute uses **0 as an unwritten-slot sentinel** — the shader
gates on `iEclipseDim > 0.0 && iEclipseDim < 1.0` so a slot the
field hasn't touched yet (Float32Array's default zero fill, or an
upload race during attribute initialisation) reads as "no dim"
instead of "fully occluded → +15 mag → culled by the visibility
prefilter". To keep the sentinel clean, `eclipse-photometry-pure`
floors its return value at `DIM_FLOOR = 0.001` (≈ 7.5 mag of dim,
dark enough to read as invisible in the additive glow composite,
but never aliasing onto zero). Without that floor a full geometric
eclipse would write exactly 0 and the shader would silently
*un-*dim the back component — exactly inverting the intended
photometry.

### Pulsation gate for eclipsing binaries

`iSuppressPulsation` is a per-instance flag built once per
`attachBinaries` from `catalog.varType` × `binaries.has_orbit`:
set 1.0 on every primary whose GCVS variability type is
`VAR_TYPE_ECLIPSING` AND that is the primary of at least one
has_orbit relation. The shader's pulsation block (radial
modulation from GCVS amplitude) is gated off for those primaries
— `EclipsePhotometryField`'s geometric signal supersedes the
GCVS-amplitude surrogate.

For an EA/EB/EW primary with NO orbital elements (no NSS or
ORB6 entry), the geometric signal isn't available and the
GCVS-amplitude pulsation stays as the fallback. The two layers
together define the boundary: when the real signal exists, it
wins; otherwise the surrogate carries on.

`star-physics.ts`'s `renderedSizePx` reads the same suppress mask
(via the optional `suppressPulsation` arg) so the SVG focus ring +
disc mask + distance-vector tip track the rendered (un-modulated)
disc on suppressed primaries.
