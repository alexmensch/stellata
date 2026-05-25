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
topological order. Each relation reads primary's CURRENT
`localPositions` slot — which may have been perturbed by the parent —
as the anchor for adding its own `−q·ΔR` perturbation. Secondaries
reset to the J2000-minus-worldOffset baseline at the top of each
update() pass, so they only carry the relation's own perturbation
(grandchild secondary motion under the outer barycentre is bounded by
the outer perturbation magnitude — typically sub-mas).
