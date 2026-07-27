# HDR seam — float render target + unified tone-map

One float render target that every light-emitting layer draws into, and
one fullscreen pass that maps it to the canvas. This is the mechanism
that makes cross-layer brightness consistent by construction: layers
stop inventing their own squash into `[0,1]` and emit a common
luminance instead.

`docs/science-hdr-pipeline.md` is the design gate — the luminance unit,
the operator's derivation, the exposure/epoch model, and the per-layer
squash replacements live there. This README carries the implementation:
target lifecycle, pass ordering, colour-space bookkeeping, and the dev
switches.

## Files in this area

```
src/client/hdr/
  hdr-pipeline.ts            HdrPipeline — target lifecycle, bind/resolve,
                             chart bypass, float-support detection, the
                             stellata_tonemap ShaderChunk registration.
  tonemap.glsl               The operator as a shared chunk. Consumed by
                             tonemap.frag.glsl and (from H3) inline by
                             each emitting shader on the fallback path.
  tonemap.frag.glsl          The fullscreen resolve. Pairs with
                             ../util/fullscreen-pass.vert.glsl.
  tonemap-pure.ts (+ test)   CPU mirror of tonemap.glsl plus the exact
                             inverse. Vitest-pinned against the design
                             doc's worked values.
  chrome-colour.ts (+ test)  Authored chrome colours pre-mapped through
                             the inverse (§ Chrome).
```

## Pass ordering — one target, two passes into it

```
hdr.bind()                 → setRenderTarget(rt)     (or null when parked)
renderer.render(scene)     → the whole main stack
localDepthPass.render()    → repaints over the same target
hdr.resolve()              → setRenderTarget(null) + fullscreen tone-map
```

`bind()` and `resolve()` are called from `stellata.ts` `animate()` and
must pair. The local depth pass never touches the render target itself,
which is exactly why its repaint lands in the same target for free —
`clearDepth()` in that pass clears the target's depth attachment, not
the canvas's. Depth semantics, core masks, and the log-depth split are
untouched: depth encoding is orthogonal to colour encoding.

**The target's depth is 24-bit.** `depthBuffer: true` with
`stencilBuffer: false` gives `DEPTH_COMPONENT24` on WebGL2 (three
r160 `setupRenderBufferStorage`). This is load-bearing — the local
depth pass derives its slice-ratio bound from a 24-bit buffer
(`../local-depth/README.md` § Precision analysis), so switching the
attachment to a 16-bit renderbuffer or a depth *texture* of the wrong
type would silently coarsen every close-range z-test by 256×.

The target is `RGBA16F`, sized to the renderer's **drawing buffer**
(canvas × pixelRatio, existing cap 2). `syncSize()` re-derives from the
renderer rather than taking a width/height, so window resize and any
future pixel-ratio change are the same code path.

## Operator

Luminance-domain extended Reinhard, hue-preserving, then highlight
desaturation, then sRGB encode, then dither — all in `stellata_tonemap`
so the fullscreen pass and the fallback path can never drift (the
`stellata_dust_raymarch` two-consumers pattern).

| Constant | Default | Role |
| --- | --- | --- |
| `L_THRESH` | 0.02 | display luminance of a source at the magnitude limit |
| `DR_MAG` | 7.5 | magnitudes of range from threshold to full white |
| `HIGHLIGHT_DESAT` | 0.35 | strength of the mix toward white above the knee |

`tonemapWhitePoint()` = `L_THRESH · 10^(0.4·DR_MAG)` = **20**, and
`reinhardExtended(20, 20) = 1` exactly — a source `DR_MAG` magnitudes
brighter than the threshold lands on full white by construction. At the
gentle end, `L = L_THRESH` resolves to 0.15 of full scale after encode.

Two properties a reader will otherwise mis-attribute:

- **Hue survives the operator, not the encode.** Scaling all three
  channels by `Yd/Y` keeps chromaticity exact. But any luminance-domain
  operator sends `Y = Lw` to output luminance 1, so a *chromatic* source
  at the white point necessarily puts its brightest channel over full
  scale and clips. Clipping — not the operator — is what breaks hue at
  the top end, and it is the reason highlight desaturation exists.
  Pinned in `tonemap-pure.test.ts`.
- **Desaturation preserves luminance pre-clamp only.** It mixes toward
  `vec3(Yd)`, whose luminance is `Yd` by definition, so the mix is
  luminance-neutral; post-clamp luminance is lower wherever a channel
  clipped. Don't test end-to-end luminance preservation above the knee —
  it isn't a property of the pipeline.

The dither is interleaved-gradient noise at ±0.5/255, applied after the
encode where 8-bit quantisation actually happens. The design doc calls
for blue noise; IGN has adequate spectral behaviour without shipping a
texture, and swapping it is a one-function change.

This pass is the single place the output transfer lives. The Display-P3
investigation (stellata-zsr.2) plugs in here as an alternate encode +
gamut matrix, nowhere else.

## Chrome — non-physical layers keep their authored look

Galactic disc + grid, LG wireframes, the constellation figure, orbit
rings, binary orbit paths, probe trails, the heliopause and Local Bubble
fresnel shells, and the cloud rim shells all render **into the target**
(they must depth-test against the scene) but **never multiply
exposure**. Their authored colours are mapped through
`inverseTonemapConstant` at material set-time, so the resolve pass
returns them at their authored appearance at any exposure.

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

Two consequences worth knowing before touching this:

- **Chrome blending is now linear.** Additive and alpha-blended chrome
  composite in linear light instead of display space, so a translucent
  line over a non-black background lands slightly differently even
  though the line-over-black case is exact. Accepted by the design gate.
- **The mapping is baked at set-time against the default white point.**
  When H8 makes `DR_MAG` live on the debug panel, every chrome colour
  must be re-mapped on change or chrome will drift while the physical
  layers track. That re-application is H8's, not something this module
  does today.

## Chart mode — full bypass

Chart renders direct to the canvas exactly as before: no target, no
tone-map, no exposure. Chart is deliberately non-photometric
ink-on-paper and every physical premise above is wrong for it, so the
bypass is both cheaper and more honest than an identity path — and it
keeps chart output pixel-identical across the whole epic.

`setMonochrome` is the seam (`stellata.ts`), alongside the existing
paper clear-colour swap. `applyTheme('mono')` is the only caller, so
mono and chart are the same state in practice.

Entering or leaving chart flips the renderer's effective output colour
space, which makes three recompile every built-in material's program
(`WebGLRenderer` compares `materialProperties.outputColorSpace`). That
is a one-time hitch on the chart transition, which already swaps
materials anyway.

## Fallback — no float-renderable buffer

`supported` is false when neither `EXT_color_buffer_float` nor
`EXT_color_buffer_half_float` is present. The instance is then inert:
`bind()` binds the canvas, `resolve()` no-ops, and every layer renders
as it did before HDR. From H3 the emitting shaders apply the shared
`stellata_tonemap` chunk inline on this path so calibration is
identical; what degrades is compositing (additive accumulation happens
on tone-mapped values, so dense fields over-brighten slightly where
sources overlap). This mirrors the extinction prepass's
same-chunk-two-paths strategy (`../star-pipeline/extinction/README.md`
§ The prepass cache).

The fallback is why the operator lives in the chunk from day one rather
than inside the fullscreen shader.

## Dev switches

- `stellata.setHdrEnabled(false)` — parks on the fallback path entirely
  (no target, no tone-map), mirroring `setExtinctionPrepassEnabled`.
- `stellata.setTonemapEnabled(false)` — keeps the target bound but makes
  the resolve straight pass-through. This is the A/B that separates a
  render-target regression from a calibration one: with the operator
  parked, the frame should match a pre-HDR build.

Pass-through is **visually** identical, not bit-identical, and the two
reasons are worth knowing before chasing a diff:

- Blending intermediates no longer round-trip through 8 bits, so faint
  gradients differ by up to a quantisation step.
- Additive accumulation clamped at 1.0 per draw on the canvas; in fp16
  it accumulates past 1.0 and clamps once at the resolve. Additive and
  max blends are unaffected (both are clamp-commutative), but a
  region that additively saturated to white *before* a later
  alpha-blended draw composites differently.

Perf rows: `submit.tonemap` (CPU submission) and, where the driver
exposes a timer query, `gpu.tonemap` — see `../debug/README.md`
§ GPU timing.

## What this bead does not do

Layers still emit their current display-encoded values, so the scene is
uniformly mis-calibrated until H3–H5 convert them (bright stars come out
dimmer, the faint Milky Way brighter). The exposure uniform, `LUMA_CEIL`,
and the `Ω_px` / `arcsecPerPx` pixel-solid-angle uniforms are **not**
introduced here — nothing consumes them until stars (H3), the Milky Way
(H4), and the exposure wiring (H6), and an unconsumed uniform plus its
resize bookkeeping is scaffolding with no reader.
