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
                             detection, every ShaderChunk registration, the
                             emitter uniform seam (§ Unit), and the
                             draw-buffer gate on attachments 1 and 2
                             (§ Three attachments). The class needs a live GL
                             context, so the test pins only that nothing can
                             switch the seam off (§ Ship gate).
  attachments/               The attachments past 0: the per-draw gate
                             every one of them goes through, and what may
                             write the statistic, in what unit — its own
                             README.
  tonemap.glsl               The operator as a shared chunk. Consumed by
                             tonemap.frag.glsl and inline by each
                             emitting shader when the target isn't bound.
  tonemap.frag.glsl          The fullscreen resolve. Pairs with
                             ../util/fullscreen-pass.vert.glsl.
  tonemap-pure.ts (+ test)   CPU mirror of tonemap.glsl plus the exact
                             inverse. Vitest-pinned against the design
                             doc's worked values.
  emission/                  The unit an emitting layer writes in:
                             magnitude → luminance, the point-source peak
                             rule, the two solid angles and the footprint
                             softening — its own README (§ Unit).
  summation/                 Attachment 2's convolution over the eye's
                             summation patch, which the resolve composites
                             — its own README (§ Pass ordering).
  exposure/                  The exposure scalar and the magnitude
                             bounds derived from it — instrument limit,
                             scene adaptation, EV trim, and the reduction
                             that measures the statistic attachment. Its
                             own README.
  chrome/                    Authored chrome colours pre-mapped through
                             the inverse — its own README (§ Chrome).
```

## Unit — what an emitting layer writes

`emission/README.md` is the contract: the magnitude → luminance rule, the
point-source peak, the extended-source surface-brightness gain and the
two solid angles it can run on. What belongs *here* is the plumbing that
carries those numbers to every layer.

`uOmegaPxArcsec2` is the solid angle one **CSS** pixel subtends, in
arcsec² (`pixelSolidAngleArcsec2`), written by
`HdrPipeline.setPixelSolidAngle` from `angularToPx(viewportHeightCssPx,
fovYRad)`. A layer needing the plate scale back — the Local Group's
resolution floor — inverts it through `stellataPxPerRadian` rather than
taking a second uniform, so a resize cannot leave the two disagreeing.
CSS again so brightness is `devicePixelRatio`-independent, and
**height** rather than the `max(w, h)` reference dimension the preset
arcsec→px conversion uses, because that is the axis the vertical FOV
maps to and the axis `physSize` projects through. Every FOV change and
every resize has to reach it; the integration shell's
`syncPixelSolidAngle` is the only caller.

**Zooming dims an extended source at the detector, but not on screen.**
Ω_px falls quadratically with FOV, so surface brightness is the physical
invariant — matching the point-source rule exactly, since a resolved
disc's `r_phys_px` grows as FOV shrinks. The *display* path no longer
follows it: the eye's summation area is angular, so a diffuse source holds
its level at any plate scale (`emission/README.md` § Extended sources). The
statistic keeps the quadratic fall; an unresolved point keeps its peak at
any FOV.

`HdrPipeline.emitterUniforms` is how a layer binds to this. Six
uniforms, held **by reference** so one write reaches every pass:
`uExposure`, `uOmegaSummationArcsec2`, `uOmegaPxArcsec2`, `uWhitePoint`,
`uHighlightDesat`, and
`uHdrTarget` — the 0/1 branch telling the shader whether to emit raw `L`
or run the operator itself. `HdrPipeline` owns every write to
`uHdrTarget` (via the same `wantsTarget()` the chrome mapping reads, so
the chart bypass reaches emitters for free); layers only read. The
resolve pass shares the white-point and desaturation objects, so inline
and fullscreen can never disagree.

## Exposure — two slots this class does not write

`uExposure` and `uOmegaSummationArcsec2` are the `emitterUniforms` slots
`HdrPipeline` never writes: both are instrument-derived, so
`ExposureController` owns them along with the three magnitude bounds
(`uLimitMag`, `uThresholdMag`, `uCullMag`). `exposure/README.md` is the
contract, and it is where the per-frame adaptation measurement lives too.
Nothing in this README's operator or target discussion depends on how
those numbers were arrived at: emitters read them, the resolve never sees
them.

## Three attachments, and a per-draw gate on two of them

The target is MRT. **Attachment 0** is display luminance, from every emitter
that draws a kernel or a surface. **Attachment 1 is RG16F**, carrying
flux-correct luminance in R and peak-correct luminance in G for the exposure
statistic to reduce. **Attachment 2** is the volumetric emitters' own: their
display value gained by the eye's summation area but not yet averaged over
it, which is what the resolve does (`summation/README.md`). Both extra
attachments are gated per draw, so nothing reaches either by accident — the
gate, the texel rule, the blend contract and the residuals are
**`attachments/README.md`**; the reduction itself is
`exposure/reduction/README.md`.

**A layer that dims light already in the target has to name the attachment
that light is in**, and the test is its blend rather than its depth — moving
the diffuse emitters to attachment 2 moved what every attenuating draw dims,
from cloud absorption to the close-range planet surfaces.
`summation/README.md` § Everything that dims the field is the statement, and
the canvas alpha is the consumer with no mark of its own.

`bind()` clears with every gate open, deliberately: the renderer's own
auto-clear runs after `bind()` returns with them shut, so without an explicit
all-attachment clear both would accumulate across frames forever. It costs a
redundant clear of attachment 0.

## Pass ordering — one target, two passes into it

```
hdr.bind()                 → setRenderTarget(rt) + clear all attachments
renderer.render(scene)     → the whole main stack
localDepthPass.render()    → repaints over the same target
hdr.resolve()              → SummationPass box-averages attachment 2 when
                             the patch is wide enough, then
                             setRenderTarget(null) + fullscreen tone-map
reduction.measure()        → own targets, then back to the canvas
```

The downsample runs inside `resolve()` rather than from `animate()`: it reads
a target only this class knows the layout of, and pairing it with the resolve
is what stops the two disagreeing about the factor
(`summation/README.md`).

`bind()` and `resolve()` are called from `stellata.ts` `animate()` and
must pair. The local depth pass never touches the render target itself,
which is exactly why its repaint lands in the same target for free —
`clearDepth()` in that pass clears the target's depth attachment, not
the canvas's. Depth semantics, core masks, and the log-depth split are
untouched: depth encoding is orthogonal to colour encoding.

`reduction.measure()` runs last and touches neither this target nor the
canvas — it binds its own chain of targets and restores, after the resolve
so the measurement never delays the frame it measured
(`exposure/reduction/README.md`).

**The target's depth is 24-bit.** `depthBuffer: true` with
`stencilBuffer: false` gives `DEPTH_COMPONENT24` on WebGL2 (three
r160 `setupRenderBufferStorage`). This is load-bearing — the local
depth pass derives its slice-ratio bound from a 24-bit buffer
(`../local-depth/README.md` § Precision analysis), so switching the
attachment to a 16-bit renderbuffer or a depth *texture* of the wrong
type would silently coarsen every close-range z-test by 256×.

The target is `RGBA16F` plus its `RG16F` statistic attachment and a second
`RGBA16F` for the diffuse emitters (§ Three attachments), sized to the
renderer's **drawing buffer** (canvas × pixelRatio, existing cap 2).
`syncSize()` re-derives from the renderer rather than taking a width/height,
so window resize and any future pixel-ratio change are the same code path —
and it reaches the summation pass's own target too.

**The diffuse attachment is 8 bytes/px on top of the 12 the other two cost**,
plus the summation pass's quarter-resolution target. That is the price of
convolving before the operator rather than gaining per fragment, and it is
why the laziness below is load-bearing rather than tidy.

## Operator

Faint-end toe, then luminance-domain extended Reinhard, hue-preserving,
then highlight desaturation, then sRGB encode, then dither — all in
`stellata_tonemap` so the fullscreen pass and the fallback path can never
drift (the `stellata_dust_raymarch` two-consumers pattern).

| Constant | Default | Role |
| --- | --- | --- |
| `L_THRESH` | 0.02 | display luminance of a source at the magnitude limit |
| `DR_MAG` | 7.5 | magnitudes of range from threshold to full white |
| `HIGHLIGHT_DESAT` | 0.35 | strength of the mix toward white above the knee |
| `TOE_BLACK_MAG` | 1.5 | magnitudes under threshold at which the toe lands on black |

`tonemapWhitePoint()` = `L_THRESH · 10^(0.4·DR_MAG)` = **20**, and
`reinhardExtended(20, 20) = 1` exactly — a source `DR_MAG` magnitudes
brighter than the threshold lands on full white by construction. At the
gentle end, `L = L_THRESH` resolves to 0.15 of full scale after encode.

**The toe is the detection rolloff below threshold** — identity at and
above `L_THRESH`, so every anchor holds, and a power below it whose
exponent (`TOE_GAMMA`, derived) puts a source exactly `TOE_BLACK_MAG`
under threshold on half an 8-bit step. Sub-threshold light no longer
renders at its near-linear Reinhard value; the Milky Way pole is the
motivating case (`../milkyway/README.md` § The gradient this produces).
Exactly invertible, and `inverseTonemapConstant` composes the inverse so
dark-authored chrome round-trips (`chrome/README.md`). The design
argument — and why a rendered sky-background pedestal was rejected — is
`docs/science-hdr-pipeline.md` § 2.

Two testing consequences of what `docs/science-hdr-pipeline.md` § 2 says
about hue and clipping: hue survival is pinned in `tonemap-pure.test.ts`,
and end-to-end luminance preservation above the knee is **not** a property
of the pipeline, so don't assert it — desaturation is luminance-neutral
pre-clamp only.

**`stellataTonemapUndithered` is the variant an overlapping emitter
wants.** The dither is a function of `fragCoord` alone, so it is the
same offset for every fragment landing on a pixel; N additively-blended
star quads would add it N times — a coherent brightness bias over dense
fields, not noise that cancels. Anything covering each pixel once (the
resolve, a fullscreen volume) wants the dithered `stellataTonemap`.
`tonemap-pure.ts` mirrors the undithered variant.

## Chrome — non-physical layers keep their authored look

Authored, non-photometric layers (galactic disc, the coordinate spheres,
LG wireframes, the constellation figure and boundaries, orbit rings,
binary orbit paths, probe markers and trails, the fresnel shells, cloud
rim shells) render into the target
but never multiply exposure: their colours are pre-mapped through the
operator's inverse so the resolve returns them as authored.
**`chrome/README.md` is the contract** — which of the two setters a call
site wants depends on how its shader emits colour, and the mapping is
only correct while the operator it inverts is running.

`HdrPipeline.syncMode` is what drives that second point: every state
change (the constructor's float-support check, both dev switches, the
chart flip) routes through it, and it re-authors every registered colour
when the operator parks.

## Chart mode — full bypass

Chart renders direct to the canvas: no target, no tone-map, no exposure,
and pixel-identical to the pre-HDR build. Why a bypass rather than an
identity path is `docs/science-hdr-pipeline.md` § 5.

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
0** — a physical luminance reaching the canvas with no operator would just
blow out. That is why the operator lives in a chunk rather than inside the
fullscreen shader, the same two-consumers strategy as the extinction
prepass (`../star-pipeline/extinction/README.md` § The prepass cache).
Two things still reach it: this fallback, and **chart mode**, which is the
reason the inline path cannot simply be deleted now that the seam has no
switch.

**This path is not a calibrated build, and that is why nothing can select
it.** A point source is fine — same `L`, same operator, same exposure, and the
**peak matches exactly**. A *diffuse* source is not: there is no attachment 2
and no pass to convolve it, so the extended-source anchor is gone entirely and
both volumetric emitters revert to the pixel solid angle
(`emission/README.md` § Extended sources), which puts the band and the Local
Group **several magnitudes faint**. There used to be a dev setter that parked
the whole frame here; it was retired precisely because "the comparison path"
and "a differently-calibrated scene" cannot be the same switch, and a release
note describing it as what older hardware gets was describing a defect as a
feature.

Three further differences, all downstream of the operator and all minor
against that one:

- Additive accumulation happens on tone-mapped values, so dense star
  fields and the MW band over-brighten slightly where sources overlap.
- The glow pass's `AdditiveBlending` multiplies rgb by the fragment's own
  alpha *after* the shader runs, so inline gives `tonemap(L·g)·g` where
  the target gives `tonemap(Σ L·g²)`. Both peak at `tonemap(peak_L)`;
  saturated stars read slightly fatter inline, because the operator
  compresses before the second multiply rather than after.
- Per-channel-max discs blend post-curve (monotonic, so the silhouette
  is unchanged).

## Ship gate — the seam is the only path

Every physical emitter carries luminance in the § Unit scale — stars (H3), the
Milky Way (H4), the planet mesh / rings / airlight / reflected glare (H5), the
Local Group glow — so the target is the path, and `supported` is the one thing
that can take it away. There is no `HDR_DEFAULT_ENABLED` and no setter:
`wantsTarget()` is `supported && !chart`, and `hdr-pipeline.test.ts` pins
that shape so a third input has to be a deliberate edit.

- **The target allocates lazily**, on first `bind()` that wants it — a
  full drawing-buffer RGBA16F plus its RG16F statistic attachment, its
  second RGBA16F and its 24-bit depth attachment is a couple of hundred MB
  of VRAM at 2x DPR on a large display. It allocates on the first frame in
  practice; keep the laziness anyway, because chart mode and an unsupported
  context both want a build that never pays for it.
- **Every emitter is on the scale.** The Local Group emission pass was
  the last one outside it; it takes the same
  `stellataSurfaceBrightnessLuminance` gain as the band, off a zero
  point derived from the solver's flux units rather than a tuned
  constant (`../local-group/README.md` § Zero free parameters).

## Dev switches

- `stellata.hdr.setTonemapEnabled(false)` — keeps the target bound but makes
  the resolve straight pass-through, isolating the target itself (depth,
  alpha, blend precision, pass order) from the operator.
- `stellata.hdr.setDynamicRangeMag(x)` / `stellata.hdr.setHighlightDesat(x)` — the
  operator's two shape knobs, live, for probing the display axis by eye.
  Both route through `syncMode`, which is what re-authors every chrome
  colour against the new white point (`chrome/README.md`).

**What `DR_MAG` does and does not buy.** Extended Reinhard is
`L(1 + L/Lw²)/(1 + L)`, already at 0.95 of full scale by `L` = 20
*whatever* `Lw` is — so raising `DR_MAG` buys hue survival at the top end
and almost no visible gradient. Detail up there needs a longer
**shoulder**, and any replacement must stay analytically invertible
because `chrome/` inverts it; a piecewise log shoulder is the shape to
reach for.

**Pass-through shows the scene blown out, and that is the point of it** —
`uHdrTarget` stays 1, so every emitter writes raw linear `L` (tens to
thousands) and the resolve hands it to an 8-bit canvas unchanged.

**It also cannot reproduce built-in-material chrome, by construction.**
What disables their `colorspace_fragment` encode is the target's linear
colour space, not the resolve — so with the operator parked,
`LineBasicMaterial` / `LineMaterial` chrome (grids, orbit paths, the
constellation figure) renders un-encoded and therefore dark. No resolve
setting fixes it: a single fullscreen pass can't both encode and not
encode. Custom-shader chrome *is* exact. There is no whole-frame comparison
to fall back on any more — § Fallback says why the one that existed was
worse than nothing.

**Chrome line work reads brighter through the seam than authored, and that
is not a bug.** § Chrome's inverse mapping is exact only for *a lone
full-alpha fragment over black*, and line work is neither — antialiased edges
are partial-alpha and lines cross each other — so the round trip lands on the
bright side. The shift on thin line work is plainly visible, nothing
downstream depends on it, and no resolve setting fixes it.

Pass-through is not bit-identical to a pre-HDR build, for two further
reasons worth knowing before chasing a diff:

- Blending intermediates no longer round-trip through 8 bits, so faint
  gradients differ by up to a quantisation step.
- Additive accumulation clamped at 1.0 per draw on the canvas; in fp16
  it accumulates past 1.0 and clamps once at the resolve. Additive and
  max blends are unaffected (both are clamp-commutative), but a
  region that additively saturated to white *before* a later
  alpha-blended draw composites differently.

Two inherent limits on the chrome mapping — exactness only for a lone
full-alpha fragment over black, and linear-space blending — are
`chrome/README.md`'s.

Perf rows: `submit.tonemap` (CPU submission) and, where the driver
exposes a timer query, `gpu.tonemap` — see `../debug/README.md`
§ GPU timing. Both scopes now include the summation downsample and the
convolution's taps, since `resolve()` runs them.
`summation/README.md` § The kernel is where the tap count is bounded.

## Not here yet

`DR_MAG` and the desaturation strength are live **dev-console** setters
(§ Dev switches); H8 puts them on the panel, alongside `L_THRESH` and the
extended-source threshold, both still baked. `DR_MAG` is the faint-end
lever H7 tunes against the eso0932a panorama — it moves the star field and
the Milky Way band together, which is the point of it, and it is no longer
the *only* faint-end lever now that the two thresholds are separable.

No emitter is outside the scale, and both volumetric emitters share one
zero point (`SB_ZERO_POINT`) and one ρ₀ solve
(`emission/README.md` § Solving ρ₀). The band is anchored on the Galaxy's
integrated M_V now; where that leaves it against the sightline photometry
is `../milkyway/README.md` § Calibration.
