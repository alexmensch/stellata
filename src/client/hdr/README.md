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
  hdr-pipeline.ts            HdrPipeline — target lifecycle (lazy alloc),
    (+ test)                 bind/resolve, chart bypass, float-support
                             detection, both ShaderChunk registrations,
                             HDR_DEFAULT_ENABLED, and the emitter uniform
                             seam (§ Unit). The class needs a live GL
                             context, so the test pins only the ship gate
                             (§ Ship gate).
  tonemap.glsl               The operator as a shared chunk. Consumed by
                             tonemap.frag.glsl and inline by each
                             emitting shader when the target isn't bound.
  tonemap.frag.glsl          The fullscreen resolve. Pairs with
                             ../util/fullscreen-pass.vert.glsl.
  tonemap-pure.ts (+ test)   CPU mirror of tonemap.glsl plus the exact
                             inverse. Vitest-pinned against the design
                             doc's worked values.
  emission.glsl              The unit: magnitude → linear luminance, the
                             point-source peak rule, and the extended-
                             source surface-brightness rule (§ Unit).
  emission-pure.ts (+ test)  CPU mirror, plus the pixel-solid-angle
                             derivation and LUMA_CEIL.
  exposure-epoch.ts          The exposure control: magnitude limit →
    (+ test)                 uExposure, the InstrumentEpoch multiplier
                             pair, and the base epoch (§ Exposure
                             epochs). No GLSL side — the shader only
                             ever reads the resulting scalar.
  chrome-colour.ts (+ test)  Authored chrome colours pre-mapped through
                             the inverse (§ Chrome).
  chunk-constant-drift.test  Pins the numbers the GLSL chunks duplicate
                             from TypeScript, and the include guards.
```

## Unit — what an emitting layer writes

`emission.glsl` (`stellata_hdr_emission`) is the other half of the
contract. `L = uExposure · 10^(−0.4·m)` from a physical V-band apparent
magnitude, clamped at `LUMA_CEIL` (4096) before the write.
`stellataPointSourcePeak` adds the flux-vs-surface-brightness rule for
anything that draws a kernel rather than a surface:

```
peak_L = L(m) / max(1, π · r_phys_px²)
```

`r_phys_px` is the source's **true angular radius in CSS pixels** —
uncapped by any viewport-fraction clamp, and CSS rather than device
pixels so a resolved disc's surface brightness doesn't shift with
`devicePixelRatio`. Below 1 px the whole flux lands on the peak; above
it the emission is true surface brightness.

A layer that draws an **extended source** instead of a kernel takes
`stellataSurfaceBrightnessLuminance` — the pixel's flux magnitude is
`S − 2.5·log10(Ω_px)` for a surface brightness `S` in mag/arcsec², and
the log round-trip through `L(m)` collapses to one scalar gain:

```
L_px = uExposure · 10^(−0.4·S) · uOmegaPxArcsec2
```

Being a single scalar is what lets a layer apply it to a coloured column
without touching chromaticity. It is **unclamped** — the caller clamps
the product against `LUMA_CEIL`, not the factor.

`uOmegaPxArcsec2` is the solid angle one **CSS** pixel subtends, in
arcsec² (`pixelSolidAngleArcsec2`), written by
`HdrPipeline.setPixelSolidAngle` from `angularToPx(viewportHeightCssPx,
fovYRad)`. CSS again so brightness is `devicePixelRatio`-independent, and
**height** rather than the `max(w, h)` reference dimension the preset
arcsec→px conversion uses, because that is the axis the vertical FOV
maps to and the axis `physSize` projects through. Every FOV change and
every resize has to reach it; the integration shell's
`syncPixelSolidAngle` is the only caller.

**Zooming dims an extended source.** Ω_px falls quadratically with FOV,
so surface brightness — not per-pixel luminance — is the invariant. That
matches the point-source rule exactly (a resolved disc's `r_phys_px`
grows as FOV shrinks, dimming its peak by the same factor) and it is the
magnification loss the epoch model's aperture multiplier pays for
(`docs/science-hdr-pipeline.md` § 3). An unresolved point keeps its peak
at any FOV, which is also correct.

`HdrPipeline.emitterUniforms` is how a layer binds to this. Five
uniforms, held **by reference** so one write reaches every pass:
`uExposure`, `uOmegaPxArcsec2`, `uWhitePoint`, `uHighlightDesat`, and
`uHdrTarget` — the 0/1 branch telling the shader whether to emit raw `L`
or run the operator itself. `HdrPipeline` owns every write to
`uHdrTarget` (via the same `wantsTarget()` the chrome mapping reads, so
the chart bypass reaches emitters for free); layers only read. The
resolve pass shares the white-point and desaturation objects, so inline
and fullscreen can never disagree.

`uExposure` is the one slot this class does **not** write — § Exposure
epochs.

**Both chunks are `#ifndef`-guarded**, and each declares the Rec.709
luma weights behind a *shared* `STELLATA_LUMA_WEIGHTS_DECLARED` guard.
An emitter that derives a per-pixel magnitude needs the unit and the
operator in one stage, and three's `resolveIncludes` pastes each
`#include` textually wherever it appears — without the guards that
combination fails to compile.

## Exposure epochs — the magnitude slider is the exposure control

`uExposure = L_THRESH · 10^(0.4·m_lim)` (`exposure-epoch.ts`), so the
"Max apparent magnitude" slider sets what the scene is exposed *for*:
a source at the limit lands on the just-noticeable floor the unit is
anchored to, and every emitter reading the shared uniform moves together.
The three presets are just three points on that curve — naked-eye 6.5 →
≈ 7.96, binoculars 10.5 → ≈ 317, all 15 → 2.0e4
(`docs/science-hdr-pipeline.md` § 3).

**`FilterController` owns the write, not `HdrPipeline`.** The magnitude
limit is filter state (`../filters/filter-state.ts`), and `uExposure`
already reaches the controller by reference inside the star pipeline's
shared uniform map, so `setFilter` writes it next to `uMaxAppMag` and
every path that moves the slider — preset button, `+`/`−` keys, URL
restore, size-override reset — is covered by construction. This is the
one exception to "`HdrPipeline` owns `emitterUniforms`"; the seed value
in `makeHdrEmitterUniforms` is `DEFAULT_FILTER.maxAppMag`'s epoch, so
the two cannot disagree before the first `setFilter`.

**Population cull and exposure are the same number.** The slider keeps
its vertex-cull semantics; that cull is now a *performance* cull
coinciding with the visibility threshold, since a star past the limit
would emit below the floor anyway. No second knob, no divergence.

`InstrumentEpoch` is the accommodation the design gate mandates: an
instrument is a pair of multipliers on the epoch — `exposureMul`
(aperture gain, applied by `epochExposure`) and `angularMag` (resolution
gain, which divides the PSF / exaggeration-K arcsec targets
`../filters/filter-state.ts` derives). Only `UNAIDED_EYE` exists today,
identity on both; instrument presets are a future epic.

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

**`stellataTonemapUndithered` is the variant an overlapping emitter
wants.** The dither is a function of `fragCoord` alone, so it is the
same offset for every fragment landing on a pixel; N additively-blended
star quads would add it N times — a coherent brightness bias over dense
fields, not noise that cancels. Anything covering each pixel once (the
resolve, a fullscreen volume) wants the dithered `stellataTonemap`.
`tonemap-pure.ts` mirrors the undithered variant.

This pass is the single place the output transfer lives. The Display-P3
investigation (stellata-zsr.2) plugs in here as an alternate encode +
gamut matrix, nowhere else.

## Chrome — non-physical layers keep their authored look

Galactic disc + grid, LG wireframes, the constellation figure, orbit
rings, binary orbit paths, probe trails and markers, the heliopause and
Local Bubble fresnel shells, and the cloud rim shells all render **into
the target** (they must depth-test against the scene) but **never
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
`bind()` binds the canvas and `resolve()` no-ops.

**A converted layer applies the operator itself whenever `uHdrTarget` is
0**, which is this path *and* the whole shipped path while the ship gate
stays false — a physical luminance reaching the canvas with no operator
would just blow out. It mirrors the extinction prepass's
same-chunk-two-paths strategy
(`../star-pipeline/extinction/README.md` § The prepass cache), and it is
why the operator lives in a chunk rather than inside the fullscreen
shader.

Calibration is identical on both paths — same `L`, same operator, same
exposure, and the **peak of any source matches exactly**. What differs is
everything downstream of the operator:

- Additive accumulation happens on tone-mapped values, so dense star
  fields and the MW band over-brighten slightly where sources overlap.
- The glow pass's `AdditiveBlending` multiplies rgb by the fragment's own
  alpha *after* the shader runs, so inline gives `tonemap(L·g)·g` where
  the target gives `tonemap(Σ L·g²)`. Both peak at `tonemap(peak_L)`;
  saturated stars read slightly fatter inline, because the operator
  compresses before the second multiply rather than after.
- Per-channel-max discs blend post-curve (monotonic, so the silhouette
  is unchanged).

Accepted: the result is approximately right rather than
differently-calibrated.

## Ship gate — the seam is off by default

`HDR_DEFAULT_ENABLED` is **false**. Stars (H3) and the Milky Way (H4)
are converted; planets (H5) still write their old display-encoded values,
so turning the seam on today changes their brightness for no gain. The
shipped default path stays the canvas one and the seam rides along
dormant.

- Flip the constant in the bead that lands the last conversion.
  `hdr-pipeline.test.ts` pins the current value, so enabling it is a
  deliberate two-line change.
- `stellata.setHdrEnabled(true)` turns it on at runtime for development.
- **The target allocates lazily**, on first `bind()` that wants it — a
  full drawing-buffer RGBA16F plus its 24-bit depth attachment is a
  couple of hundred MB of VRAM at 2× DPR on a large display, and a
  dormant seam must not cost that. Don't move the allocation back into
  the constructor.
- Each intervening bead has to keep **both** paths working and smoke
  both. A converted layer's inline `stellata_tonemap` (§ Fallback) is
  not exotic-hardware insurance — it is what users are running.

## Dev switches

- `stellata.setHdrEnabled(true/false)` — the seam itself. False (the
  shipped default, § Ship gate) is the pre-HDR path entirely: no target,
  no tone-map, chrome back to authored colours. It is also the path
  hardware without a float-renderable target takes. **This is the full
  A/B**, and while the ship gate stays false it is what users get.
- `stellata.setTonemapEnabled(false)` — keeps the target bound but makes
  the resolve straight pass-through. Narrower: it isolates the target
  itself (depth, alpha, blend precision, pass order) from the operator.

**Pass-through shows converted layers blown out, and that is the point
of it** — `uHdrTarget` stays 1, so stars write raw linear `L` (tens to
thousands) and the resolve hands it to an 8-bit canvas unchanged. The
mode isolates the *target* (depth, alpha, blend precision, pass order)
from the *operator*; it is not a look comparison. Unconverted emitters
still write display-encoded values and are exact in it.

**It also cannot reproduce built-in-material chrome, by construction.**
What disables their `colorspace_fragment` encode is the target's linear
colour space, not the resolve — so with the operator parked,
`LineBasicMaterial` / `LineMaterial` chrome (grids, orbit paths, the
constellation figure) renders un-encoded and therefore dark. No resolve
setting fixes it: a single fullscreen pass can't both encode and not
encode. Custom-shader chrome *is* exact. Use `setHdrEnabled(false)` when
you want a whole-frame comparison.

Neither switch is bit-identical to a pre-HDR build, for two further
reasons worth knowing before chasing a diff:

- Blending intermediates no longer round-trip through 8 bits, so faint
  gradients differ by up to a quantisation step.
- Additive accumulation clamped at 1.0 per draw on the canvas; in fp16
  it accumulates past 1.0 and clamps once at the resolve. Additive and
  max blends are unaffected (both are clamp-commutative), but a
  region that additively saturated to white *before* a later
  alpha-blended draw composites differently.

One more inherent limit on the chrome mapping: it is exact for a chrome
fragment landing alone at full alpha over black. Translucent and additive
chrome contributes `L · α` into the target, and the operator is
non-linear, so `tonemap(L·α) ≠ α · tonemap(L)`. Dim chrome sits in the
toe where the operator is ~linear and the error is negligible; bright
near-white chrome (the heliopause limb) shifts visibly. This is the
linear-space-blending trade the design gate accepted
(`docs/science-hdr-pipeline.md` § 4).

Perf rows: `submit.tonemap` (CPU submission) and, where the driver
exposes a timer query, `gpu.tonemap` — see `../debug/README.md`
§ GPU timing.

## Not here yet

`DR_MAG`, `L_THRESH` and the desaturation strength become live panel
knobs in H8, which then has to re-apply the chrome mapping on every
change (§ Chrome). `DR_MAG` is also the faint-end lever H7 tunes against
the eso0932a panorama — it moves the star field and the Milky Way band
together, which is the point of it.

The planet layers are the exposure control's one blind spot until H5
converts them: their mesh + glare are still on their own LDR encodings,
so the slider changes the star field and the Milky Way band without
touching a planet's brightness. Nothing double-counts — the alternative
(the old quarter-power slider term in `litIntensity`) put planets on a
*second* exposure curve, which is worse the moment they land on this one.
