# Chrome colours — non-physical layers keep their authored look

The inverse-tone-map mapping that lets authored, non-photometric layers
render *through* the scene-wide operator and come out looking exactly as
authored. `../README.md` is the seam this plugs into; the operator it
inverts is `../tonemap.glsl`.

```
src/client/hdr/chrome/
  chrome-colour.ts (+ test)  The two setters, the module-level registry of
                             live bindings, and the two pieces of operator
                             state — active flag and white point — that
                             re-author all of them on change.
```

Galactic disc, the coordinate spheres, LG wireframes, the constellation
figure and boundaries, orbit rings, binary orbit paths, probe trails and
markers, the heliopause and Local Bubble fresnel shells, and the cloud rim
shells all render **into the target** (they must depth-test against the scene) but **never
multiply exposure**. Their authored colours are mapped through
`inverseTonemapConstant` at material set-time, so the resolve pass
returns them at their authored appearance at any exposure.

A probe marker counts as chrome for the same reason its own README gives
for the glyph — the spacecraft subtends no angle at any range, so the
marker stands in for it rather than depicting its light. The
dust-particle layer is the one chrome layer left unmapped: it is shelved
at strength 0 and carries no colour uniform to map, so unshelving it
owes this pass a look.

`chrome-colour.ts` exposes two setters, and **which one a call site
wants depends on how its shader emits colour** — this is the one part
of the mapping that is easy to get silently wrong:

- `setBuiltinChromeColour` — for three's built-in materials
  (`LineBasicMaterial`, `LineMaterial`, `MeshBasicMaterial`). Their
  fragment shader carries `colorspace_fragment`, whose linear→sRGB
  encode is what put the authored hex on screen. Rendering to a
  non-XR render target makes three pick `LinearSRGBColorSpace` for the
  output, which switches that encode **off** — so these materials emit
  linear into the target and the mapped value goes in as linear
  working-space components.
- `setRawChromeColour` — for custom `ShaderMaterial` /
  `RawShaderMaterial` chrome that writes a colour uniform straight out.
  `new THREE.Color(hex)` linearises on construction (ColorManagement is
  on by default) and the shader then emitted that linear number *as a
  display value*, so what these layers have always shown is the hex
  decoded twice. That doubly-darkened appearance is what they were
  tuned against, so it is what this setter preserves — it is not a bug
  being carried forward blindly, it is the tuned look. Correcting it is
  a deliberate visual change, not part of the HDR seam.

Both setters write via `Color.setRGB(..., LinearSRGBColorSpace)` so
ColorManagement doesn't convert the mapped value a second time.

**The mapping is only correct paired with the operator it inverts.** Left
in place with the operator off, chrome renders badly wrong — a rim shell
drops to a tenth of its authored brightness, a near-white probe marker
clips to flat white. So every call is recorded in a module-level registry
and `setChromeOperatorActive(false)` re-authors all of it back to plain
`setHex`, which is exactly the pre-HDR Color state for both variants.
`HdrPipeline.syncMode` drives that flag, and every state change routes
through it: the float-support check in the constructor (**before any
layer is built**, so a context without a float-renderable target never
registers a mapped colour), both dev switches, and the chart flip.
Getting this wrong is not a dev-only concern — the float-support path is
what real fallback hardware takes, and chart parks the operator too.

The registry is keyed by the live `Color`, so a re-attachable layer
(clouds, Local Group) adds an entry per attach; `HdrPipeline.dispose`
clears it.

Two consequences worth knowing before touching this:

- **Chrome blending is now linear.** Additive and alpha-blended chrome
  composite in linear light instead of display space, so a translucent
  line over a non-black background lands slightly differently even
  though the line-over-black case is exact. Accepted by the design gate.
- **The mapping is baked at set-time against a white point this module
  holds**, and `setChromeWhitePoint` is what keeps it honest: `DR_MAG` is
  a live dev knob (`../README.md` § Dev switches), it moves the curve
  every physical layer runs through, and chrome left on the old white
  point would drift against them. `HdrPipeline.syncMode` writes it
  alongside the operator-active flag, so the two can never disagree.

