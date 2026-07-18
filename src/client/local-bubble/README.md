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
- `local-bubble.ts` — `LocalBubbleShell`: builds a `BufferGeometry` from
  the parsed mesh (`computeVertexNormals` at runtime), renders it with the
  Fresnel shader, and folds the detail-cycle + chart gates into
  `group.visible`.
- `local-bubble.{vert,frag}.glsl` — the shell shader.

## Invariants

- **Frame.** Mesh positions are **absolute ICRS pc, Sol origin** (the
  `catalog.bin` frame). The group sits at `−worldOffset` (`recenter`),
  exactly like the heliopause — non-zero under planet focus, where the
  floating origin leaves Sol.
- **Camera-inside.** The camera sits inside the ~200 pc shell, so the
  material is `DoubleSide` and the mesh is `frustumCulled = false`
  (bounding-sphere culling is unreliable with the camera interior). The
  fragment shader flips the normal by `gl_FrontFacing` so the Fresnel rim
  is symmetric on both faces, and tints the inner vs outer face
  differently so orientation reads.
- **renderOrder −1**, additive, `depthWrite:false`: a dim background
  glow the local stars composite over. See `src/client/README.md`
  § Render order.

## Data + validation

Built from the Zucker 2022 inner-surface HEALPix map; the build
cross-checks the surface against the independent Edenhofer dust grid
(`scripts/local-bubble/README.md` § Dust cross-check). Wall distance
~75–300 pc; the Sun is inside, off-centre.

## Not yet

The centroid "Local Bubble" text label and any per-layer visual tuning
(opacity / colour / smoothing column) are follow-up (`stellata`-tracked).
