# Planet depth pre-stamp

A depth-only copy of every opaque planet mesh, drawn first in the **main**
pass so the star field, band and cloud stack behind a close planet are
never shaded. The star core mask's mechanism over a spheroid.

## Files

- `depth-stamp-pure.ts` (+ test) — `DEPTH_STAMP_SHRINK`,
  `depthStampRadius`, `depthStampDrawn`. The `renderOrder −4` slot is not
  this folder's to name: the star core mask writes it too, so it is
  `DEPTH_MASK_RENDER_ORDER` in `../../../scene/render-order.ts`.

The meshes themselves live on `PlanetMeshLayer` (`../planet-mesh-layer.ts`,
one `stamp` per `MeshEntry`, in `depthStampGroup`), the material on both
seam factories (`../../materials/README.md`, `planetDepthStamp()`), and
the frame-cost row on the pass roster
(`../../../debug/frame-cost/passes/README.md`).

## Why

The mesh writes its depth in the local depth pass, whose depth is cleared
before it repaints (`../../../local-depth/README.md` § Architecture) — so
the main pass shades everything behind a screen-filling planet and the
local pass then paints over it. The pre-stamp puts the body's depth where
the main pass can test against it: a second `THREE.Mesh` per opaque body
over the same spheroid geometry, `colorWrite: false`, at `renderOrder −4`
beside the star core mask, in `depthStampGroup` — which the planet module
parents into the **main** scene, never the pass scene. Every background
layer drawn after −4 depth-fails inside the silhouette and its fragments
never shade (`../../../README.md` § Full render stack — front to back).

## What stamps, and how far inside

- **Only an opaque mesh** — `depthStampDrawn(fade)`, i.e. `fade ≥ 1`.
  Inside the crossfade band the mesh blends with the background, which
  must therefore still draw.
- **Shrunk by `DEPTH_STAMP_SHRINK`** (10⁻³ of the radius, both axes, so an
  oblate body keeps its flattening). Perspective x/y are independent of
  near/far, so the main-pass stamp and the local-pass mesh project the
  same geometry to the same pixels; the margin covers float differences
  between the two draws and nothing else. The stamp sits inside the
  **mesh**, not the atmosphere shell — the shell lies outside the mesh and
  is additive over the background there.
- **The two passes' CLIP volumes differ, and that is a separate argument**
  — projection is only half of "the same pixels". The main pass runs
  `near = CAMERA_NEAR_PC` (1e-12 pc) while the local pass runs a bracket,
  so a bracket near plane *inside* the body would slice away mesh the
  stamp had already culled the background behind. What forbids it is
  `computeBracket`'s `near = NEAR_FRACTION (0.5) × nearest member surface`
  (`../../../local-depth/bracket/slice-pure.ts`): the bracket's near plane
  is always closer than the nearest body's near surface, and every member
  sphere bounds its own mesh. Raising `NEAR_FRACTION` to 1, or admitting a
  member whose sphere under-bounds what it draws, punches holes here and
  nowhere else.
- **True depth in the main pass's own encoding**, not a near pin. Nothing
  renderable in the main pass sits between the camera and a local body,
  so the two are equivalent today; true depth stays honest if that ever
  changes and needs no vertex-stage pin.
- Hidden with the mesh: the observe-anchor body, chart mode, a body that
  leaves the crossfade band.

## The exposure cannot move

Culled background fragments no longer write the statistic attachment
inside the silhouette — but the local-pass mesh is an occluding emitter
compositing at alpha 1 over the same texels, so the final statistic there
was the mesh's already. The applied cut is unchanged by construction.

## Both backends

GLSL: a `MeshBasicMaterial` with colour writes off — non-raw, so the main
pass's log-depth chunks apply themselves, and unmarked, so the attachment
gate keeps slots 1 and 2 shut. TSL: a `NodeMaterial` through
`finishMrtMaterial` with colour writes off, which still needs the
single↔struct swap for three's pipeline cache
(`../../../webgpu/hdr/README.md` § The gate becomes the output struct).

## Priced, not assumed

`planetDepthStamp` is a frame-cost row (`setDepthStampEnabled`). It adds
one draw per opaque body to the main pass — zero at four canon vantages,
one or two at Earth close approach, where the win lands. The row reads as
skipped wherever no body is opaque.
