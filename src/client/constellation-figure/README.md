# Constellation figure

The classical constellation stick figure, drawn as depth-tested line segments
in the main scene between member stars' local-frame positions. Highlight one
figure in navigate mode, or all 88 in chart mode. Only the lines live here; the
chart-mode Latin **name** labels are `chart-mode/` / `overlays/` chrome.

## Files

- `constellation-figure.ts` (+ test) — `ConstellationFigure`, the shell's
  `constellationFigure` namespace ([The owner](#the-owner)).
- `constellation-figure-layer.ts` — `ConstellationFigureLayer`: a
  `THREE.LineSegments` group. Event-driven geometry rebuild (`setFigures`) plus
  a per-frame position refresh (`update`).
- `constellation-figure-pure.ts` — `collectFigureSegmentEndpoints`: expands the
  catalog's per-constellation polylines into a flat line-segment endpoint list
  (two star indices per segment), dropping any segment that touches
  `excludeStarIdx`. Plus `selectFigures`: the active set, the anchor exclusion and the
  rebuild signature, so the whole decision is testable without a shell; and
  `figureAimPoint` ([The aim point](#the-aim-point)). All vitest-pinned.
- `constellation-figure-pure.test.ts` — endpoint-expansion, exclusion,
  selection and aim-point pins.

## The owner

`ConstellationFigure` (`constellation-figure.ts`) holds the layer, its
`'state'` subscription and the last selection signature, answers the aim point
([The aim point](#the-aim-point)), and builds its own
scene entry: `clock` at the binaries' rate, because a vertex may be a binary
member ([Anchored content](../scene/README.md#anchored-content-declares-its-anchors-rate)). **It is built after the
filter, focus and observe controllers**, because it seeds its active set
from all three in its constructor; the declutter push reaches it through a
closure that first fires after that. The shell registers the entry after the
binary and planet walks ([Rebuild vs refresh](#rebuild-vs-refresh)).

## Why scene geometry, not SVG

SVG composites above the resolved frame with no depth relationship to it, so an
SVG figure would need a screen-space cutout for every body in front of it — of
unbounded shape (oblate limbs, ring annuli, moons). As depth-tested geometry the
figure is occluded by the depth buffer like everything else in the scene.

## Occlusion — no dedicated mechanism

The lines render at `renderOrder −0.75` with `depthTest: true`,
`depthWrite: false`:

- **Close star / planet discs occlude the lines** through the depth buffer. The
  `renderOrder −4` star **and** planet core depth-masks stamp near-z before the
  lines draw (the same pass that keeps the Milky Way / grid / clouds from
  bleeding through bright cores — [Full render stack](../scene/README.md#full-render-stack--front-to-back)), so a line
  behind a close disc or planet depth-fails.
- **Saturn's true mesh + ring silhouette** occludes the lines through the local
  depth pass (`../local-depth/README.md`): that pass repaints the local system
  over the finished frame, so the ring annulus — which no analytic mask shape
  could describe — occludes the lines like any other geometry.
- **Star discs / glow composite over the lines** where a member sits on one:
  discs (`renderOrder 0`) and glow (`1`) draw after the lines and `depthWrite`
  is off, so the light source wins the pixel — the same "annotation under the
  star" convention the binary orbit paths (`−0.5`) already follow, so the line
  needs no screen-space gap around each vertex star.

## Rebuild vs refresh

The vertex buffer is the members' `stellata.localPositions` — the same
floating-origin frame the star instances use, so the GPU projection lines up
with the discs automatically and **camera motion adds no CPU work** — the
per-frame refill below is a fixed cost independent of the camera.

- `setFigures(constellations, conIndices, localPositions, excludeStarIdx)` —
  rebuild geometry. `conIndices` is the highlighted one, all 88 (chart), or
  empty (nothing highlighted). The owner pushes it off `'state'` and skips the
  rebuild on an unchanged `selectFigures` signature: every fine-grained
  mutation the set reads (focus, filter, cameraMode) pairs with `'state'`
  ([Event bus](../README.md#event-bus-on-stellata)), and so does the observe transition's landing,
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
  (`representational`; `../scene/declutter/README.md`), pushed from the detail bind.
- `setFigures(..., [])` — nothing highlighted outside chart mode.
- `setFigures(..., excludeStarIdx)` — the observe vantage point ([The observe
  anchor](#the-observe-anchor)). Every segment touching that star drops out of the geometry.
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
and it whips across the sky before collapsing to a point on arrival, which
reads as noise. Nothing gates this scene layer on the observe
transition (the `body.focus-lerping` class hides only the SVG overlay), so the
glide draws every frame. Hence `selectFigures` excludes
`ObserveTransition.observeAnchorOf('star')`, which spans both glides — the
rule and why the mode flag alone is wrong live in
[The observe anchor in line layers](../camera/observe/README.md#the-observe-anchor-in-line-layers), along
with the other line layers asking the same question.

A planet or probe anchor suppresses nothing here yet, which is unreachable
rather than correct: [The observe anchor in line layers](../camera/observe/README.md#the-observe-anchor-in-line-layers)
says why and where the host resolution has to land.

## The aim point

Picking a constellation swings the camera to face `aimPoint(conIndex, from)`
(the pure half is `figureAimPoint`): the plain
mean of the `AIM_BRIGHTEST_COUNT` (8) figure members that look brightest
**from the orbit target**, not from Sol, each vertex counted once. Far from
Sol the same figure is then centred on whichever members dominate from
*there*. It reads the vertices through `localPositionInto`, the frame the
camera and target live in, once per pick; chunk 0 holds every vertex
([Late-attached slots](../README.md#late-attached-slots)), so a pick at first paint
reads decoded positions. Null for a figure with no vertex, and the shell's
`aimAtConstellation` then returns before claiming the camera, so a no-op
pick cancels nothing ([Picking a constellation aims the camera](../camera/controls/README.md#picking-a-constellation-aims-the-camera)).

## Styling

The shared alpha-blended stroke (`chrome-lines/README.md`) +
`util/orbit-line`'s `makeOrbitLineSegments` primitive, 1 px: a WebGPU line
primitive has no width, and the renderer runs `antialias: false`. Sky-blue in
navigate mode, chart ink in chart mode. If long figure spans alias worse than
the short orbit rings do, the escalation is the seam's fat stroke
([The fat stroke brings its own object](../chrome-lines/README.md#the-fat-stroke-brings-its-own-object)).
