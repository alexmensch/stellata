# src/client/local-bubble/ — Local Bubble shell

Runtime for the Local Bubble shell: a translucent Fresnel-rim mesh of the
cavity's inner (dust-traced) wall, giving immediate context that the Sun
sits *inside* a bubble. A `representational`-tier declutter element
(`localBubbleShell`, `scene/README.md`).

## Files

- `local-bubble-loader.ts` — `parseLocalBubble(buf)` / `loadLocalBubble(url)`
  for `public/local-bubble.bin` (magic `LBUB`; format in
  `scripts/local-bubble/README.md`). `load*` resolves null when the asset
  is absent — the layer is optional.
- `local-bubble.ts` — `LocalBubbleShell` (builds a `BufferGeometry` from
  the parsed mesh, `computeVertexNormals` at runtime, folds the
  detail-cycle + chart gates into `group.visible`) plus
  `createLocalBubbleLabel` (the centroid SVG label).
- `local-bubble.{vert,frag}.glsl` — the Fresnel shell shader.

## Invariants

- **Frame.** Mesh positions are **absolute ICRS pc, Sol origin** (the
  `catalog.bin` frame). The group sits at `−worldOffset` (`recenter`),
  exactly like the heliopause — non-zero under planet focus, where the
  floating origin leaves Sol.
- **Hide-when-inside.** The material is `FrontSide` (like the heliopause)
  and the build orients the winding **outward**, so the shell back-face-
  culls when the camera sits inside the bubble — the common view at Sol —
  and appears only when the camera flies out beyond the wall (~300 pc).
  Without this the near-wall rim glow washes the whole scene. The mesh is
  `frustumCulled = false` (bounding-sphere culling is unreliable with the
  camera interior).
- **renderOrder −1**, additive, `depthWrite:false`: a dim rim glow the
  local stars composite over. See `src/client/README.md` § Render order.
- **Label** (`localBubbleLabel`, a `labels`-tier declutter element at
  floor `all`) is an SVG `<text>` bound through the shared distance-gated
  label engine over ~96 shell-surface samples, so it hugs the silhouette.
  Because the samples sit on the wall, the engine's near-plane bail hides
  the label whenever the camera is inside the bubble — the same mechanism
  (and behaviour) as the heliopause apex label.

## Data + validation

Built from the Zucker 2022 inner-surface HEALPix map; the build
cross-checks the surface against the independent Edenhofer dust grid
(`scripts/local-bubble/README.md` § Dust cross-check). Wall distance
~75–300 pc; the Sun is inside, off-centre.

## Not yet

Per-layer visual tuning (opacity / colour / Fresnel power / smoothing
column) is follow-up (`stellata`-tracked).
