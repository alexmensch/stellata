# Constellation figure

The classical constellation stick figure, drawn as depth-tested WebGL line
segments between member stars' local-frame positions. Highlight one figure in
navigate mode, or all 88 in chart mode.

This layer renders inside the WebGL scene, so it is **not** an SVG overlay —
the constellation hull is gone and the chart-mode Latin **name** labels stay in
`chart-mode/` / `overlays/` chrome; only the figure lines live here.

## Files

- `constellation-figure-layer.ts` — `ConstellationFigureLayer`: a
  `THREE.LineSegments` group. Event-driven geometry rebuild (`setFigures`) plus
  a per-frame position refresh (`update`).
- `constellation-figure-pure.ts` — `collectFigureSegmentEndpoints`: expands the
  catalog's per-constellation polylines into a flat line-segment endpoint list
  (two star indices per segment). Vitest-pinned.
- `constellation-figure-pure.test.ts` — endpoint-expansion pin.

## Why WebGL, not SVG

The figure was the last line geometry drawn as SVG (a `<path>` above the
canvas), which forced the whole disc-occlude-mask apparatus: SVG sits outside
the depth buffer, so every occluding body needed a CPU-computed screen-space
cutout, with unbounded shape complexity ahead (oblate limbs, ring annuli,
moons). Drawing the figure as depth-tested geometry deletes that apparatus and
gets correct occlusion for free.

## Occlusion — no dedicated mechanism

The lines render at `renderOrder −0.75` with `depthTest: true`,
`depthWrite: false`:

- **Close star / planet discs occlude the lines** through the depth buffer. The
  `renderOrder −4` star **and** planet core depth-masks stamp near-z before the
  lines draw (the same pass that keeps the Milky Way / grid / clouds from
  bleeding through bright cores — `../README.md` § Full render stack), so a line
  behind a close disc depth-fails. A planet is now occluding for real — the
  bug the shelved disc-mask planet-cutout approach chased.
- **Saturn's true mesh + ring silhouette** occludes the lines once the local
  depth pass migrates on (`../local-depth/README.md`): that pass repaints the
  local system over the finished frame, so the ring annulus — impossible for any
  analytic mask shape — occludes the lines like any other geometry.
- **Star discs / glow composite over the lines** where a member sits on one:
  discs (`renderOrder 0`) and glow (`1`) draw after the lines and `depthWrite`
  is off, so the light source wins the pixel — the same "annotation under the
  star" convention the binary orbit paths (`−0.5`) already follow. No
  screen-space gap around each vertex star is needed (or drawn); the SVG gap
  existed only to fake that ordering.

## Rebuild vs refresh

The vertex buffer is the members' `stellata.localPositions` — the same
floating-origin frame the star instances use, so the GPU projection lines up
with the discs automatically and **camera motion adds no CPU work** — the
per-frame refill below is a fixed cost independent of the camera.

- `setFigures(constellations, conIndices, localPositions)` — rebuild geometry.
  The shell calls it when the active set changes: the highlighted index, chart
  ↔ navigate, or the `showConstellation` master toggle. `conIndices` is the
  highlighted one, all 88 (chart), or empty (hidden).
- `update(localPositions)` — re-copies vertex positions from the live buffer
  every drawn frame, so a vertex tracks its star through everything that
  rewrites `localPositions` with no separate signal: proper-motion epoch
  advance, floating-origin recentre, **and binary orbital motion under time
  scrub** (a figure vertex is often a bright binary — Mizar, Castor, Algol).
  The buffer is at most a few thousand floats, so the copy + re-upload is
  negligible; the `BinaryOrbitPathLayer` repositions per frame the same way.
  Skipped while the group is hidden.

## Visibility gates

Three inputs, all pushed (no per-frame recompute):

- `setPermitted(on)` — the `constellationFigures` declutter floor
  (`representational`; `../scene/README.md`), pushed from the detail bind.
- `setFigures(..., [])` — the `showConstellation` master toggle off, or nothing
  highlighted outside chart mode.
- `setMonochrome(on)` — chart mode swaps the sky-blue stroke for ink and drops
  `depthTest` so the figure reads flat over the depth-disabled chart starfield.

## Styling

The shared `util/orbit-line` alpha-blended material + `LineSegments` primitive
(`makeOrbitLineMaterial` / `makeOrbitLineSegments`), 1 px (the renderer runs
`antialias: false`, so linewidth is driver-pinned to 1 regardless). Sky-blue in
navigate mode, chart ink in chart mode. If long figure spans alias worse than
the short orbit rings do, the escalation is quad-strip segments with a soft-edge
fragment alpha (same fallback noted for the orbit lines).
