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
  (two star indices per segment), dropping any segment that touches
  `excludeStarIdx`. Plus `selectFigures`: the active-set + anchor rule and the
  rebuild signature, so the whole decision is testable without a shell. Both
  vitest-pinned.
- `constellation-figure-pure.test.ts` — endpoint-expansion, exclusion, and
  selection pins.

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

- `setFigures(constellations, conIndices, localPositions, excludeStarIdx)` —
  rebuild geometry. `conIndices` is the highlighted one, all 88 (chart), or
  empty (nothing highlighted). The shell pushes it off `'state'` and skips the
  rebuild on an unchanged `selectFigures` signature: every fine-grained
  mutation the set reads (focus, filter, cameraMode) pairs with `'state'`
  (`../README.md` § Event bus), and so does the observe transition's landing,
  which no fine-grained event covers.
- `update(localPositions)` — re-copies vertex positions from the live buffer
  every drawn frame, so a vertex tracks its star through everything that
  rewrites `localPositions` with no separate signal: proper-motion epoch
  advance, floating-origin recentre, **and binary orbital motion under time
  scrub** (a figure vertex is often a bright binary — Mizar, Castor, Algol).
  The buffer is at most a few thousand floats, so the copy + re-upload is
  negligible; the `BinaryOrbitPathLayer` repositions per frame the same way.
  Skipped while the group is hidden.

## Visibility gates

Four inputs, all pushed (no per-frame recompute):

- `setPermitted(on)` — the `constellationFigures` declutter floor
  (`representational`; `../scene/README.md`), pushed from the detail bind.
- `setFigures(..., [])` — nothing highlighted outside chart mode.
- `setFigures(..., excludeStarIdx)` — the observe vantage point (§ The observe
  anchor). Every segment touching that star drops out of the geometry.
- `setMonochrome(on)` — chart mode swaps the sky-blue stroke for ink and drops
  `depthTest` so the figure reads flat over the depth-disabled chart starfield.

## The observe anchor

**The settled pose was never the problem.** OBSERVE parks the camera at the
focal object's live local position (`../camera/observe/observe-transition.ts`),
which is the same `localPositions` slot a figure vertex reads — so the camera
sits exactly *on* the anchor's own vertex. Every point of a segment leaving that
vertex then lies on the view ray through its far endpoint, so the whole segment
projects to one screen point and renders as a zero-length line. Near-plane
clipping does not change it: the surviving remainder is on the same ray. There
is nothing to see, with or without the suppression.

**The visible window is the glide.** Entry and exit each translate the camera
between the park distance and the star over `OBSERVE_TRANSITION_MS`. While one
endpoint is approaching the camera the segment's projected direction runs away,
and it whips across the sky before collapsing to a point on arrival — the
"lines read as noise" report. Nothing gates this WebGL layer on the observe
transition (the `body.focus-lerping` class hides only the SVG overlay), so the
glide draws every frame. Hence `selectFigures` keys the suppression on
`inObserve || observeGlideActive` (`ObserveTransition.isActive` — enter/exit,
never the navigate-mode `unfocus` kind): the mode flag alone covers entry and
leaves the identical smear on the way out, since exit emits
`cameraMode='navigate'` at glide *start*.

**A non-star anchor keeps its host's lines, and that is not a geometric
argument.** `focus.getFocusedStar()` is null for every non-star kind, so a
planet or probe anchor suppresses nothing. Today that is unreachable rather
than correct: Sol is the only attached planet host and carries no figure vertex
(figures resolve from Stellarium HIP lists, `scripts/catalog/parse/constellations.ts`).
It is not defensible on geometry — a planet sits ~5×10⁻⁶ pc from its host
against parsec-scale segments, so an exoplanet anchor's host lines would
converge on the camera to within microradians and smear exactly as a star
anchor's do. When exoplanet hosts land, the anchor has to resolve through the
host (`focusedStar ?? focusedPlanetSystem.hostStarIdx`, which covers probes for
free).

## Styling

The shared alpha-blended stroke (`chrome-lines/README.md`) +
`util/orbit-line`'s `makeOrbitLineSegments` primitive, 1 px (the renderer runs
`antialias: false`, so linewidth is driver-pinned to 1 regardless). Sky-blue in
navigate mode, chart ink in chart mode. If long figure spans alias worse than
the short orbit rings do, the escalation is quad-strip segments with a soft-edge
fragment alpha (same fallback noted for the orbit lines).
