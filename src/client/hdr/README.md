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
                             HDR_DEFAULT_ENABLED, the emitter uniform
                             seam (§ Unit), and the statistic attachment's
                             draw-buffer gate (§ Statistic attachment).
                             The class needs a live GL context, so the test
                             pins only the ship gate (§ Ship gate).
  statistic/                 The target's second attachment: what may
                             write it, in what unit — its own README.
  tonemap.glsl               The operator as a shared chunk. Consumed by
                             tonemap.frag.glsl and inline by each
                             emitting shader when the target isn't bound.
  tonemap.frag.glsl          The fullscreen resolve. Pairs with
                             ../util/fullscreen-pass.vert.glsl.
  tonemap-pure.ts (+ test)   CPU mirror of tonemap.glsl plus the exact
                             inverse. Vitest-pinned against the design
                             doc's worked values.
  emission.glsl              The unit: magnitude → linear luminance, the
                             point-source peak rule, the extended-source
                             surface-brightness rule (§ Unit), and the
                             plate scale recovered from the pixel solid
                             angle.
  extended-emitter.glsl      The write tail a volumetric emitter shares:
                             gain, clamp, both attachments, and the
                             inline operator off-target. Composes the two
                             chunks above, so it is the only include a
                             raymarching stage needs (§ Extended sources).
  emission-pure.ts (+ test)  CPU mirror, plus the pixel-solid-angle
                             derivation and its inverse, LUMA_CEIL,
                             SB_ZERO_POINT (the zero point both volumetric
                             emitters share) and lumaNormalisedTint, the
                             hue-only tint they multiply (§ Unit).
  exposure/                  The exposure scalar and the magnitude
                             bounds derived from it — instrument limit,
                             scene adaptation, EV trim, and the reduction
                             that measures the statistic attachment. Its
                             own README.
  chrome/                    Authored chrome colours pre-mapped through
                             the inverse — its own README (§ Chrome).
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

**Being a scalar is also why an emitter's tint must carry hue only.** It
multiplies every channel equally while the emissivity it scales was
normalised against a total flux, so a tint whose relative luminance isn't 1
rescales that emitter's flux by that luminance — 0.42 mag on the Local
Group disc family, 0.39 mag on the band. `lumaNormalisedTint` owns it.

**A reflecting body uses both rules, and that is what closes the resolve
step.** A planet's glare billboard takes `stellataPointSourcePeak` with
the same `m` the star field would use, while its mesh takes the
surface-brightness rule with the disc's mean `S` — and past 1 px the two
are the *same quantity*, so a body crossing from point to resolved mesh
does not change brightness. The disc-mean derivation and the two
normalisers that make the shaded disc integrate back to `L(m)` are
`../solar-system/planets/README.md` § Physical-luminance emission; the
mesh reads `uOmegaPxArcsec2` for the same reason the Milky Way does.

### Extended sources — one write tail

Everything after the gain is identical for every volumetric emitter, so
`extended-emitter.glsl` (`stellata_extended_emitter`) owns it:
`stellataEmitExtendedSource` applies the gain, clamps at `LUMA_CEIL`,
writes the statistic texel, and off-target runs the operator undithered;
`stellataEmitNothing` is the miss case. Both take the attachments as
`out` params, making "attachment 1 has no default, so every branch must
write it" one decision rather than one per early return. Consumers:
`milkyway.frag.glsl` (which keeps its own magnitude step, since the chart
isobar contours `magPx`) and `local-group-emission.frag.glsl`.

It `#include`s both chunks above — three resolves includes recursively
and the guards make the extra paste inert. `chunk-constant-drift.test.ts`
resolves every extended-source stage through the real `ShaderChunk`
registry, so a misspelled chunk name fails in vitest, not on first frame.

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

**Both chunks are `#ifndef`-guarded**, and each declares the Rec.709
luma weights behind a *shared* `STELLATA_LUMA_WEIGHTS_DECLARED` guard.
An emitter that derives a per-pixel magnitude needs the unit and the
operator in one stage, and three's `resolveIncludes` pastes each
`#include` textually wherever it appears — without the guards that
combination fails to compile.

## Exposure — one slot this class does not write

`uExposure` is the one `emitterUniforms` slot `HdrPipeline` never writes.
`ExposureController` owns it, along with the three magnitude bounds
derived from the same state (`uLimitMag`, `uThresholdMag`, `uCullMag`) —
`exposure/README.md` is the contract, and it is where the per-frame
adaptation measurement lives too. Nothing in this README's operator or
target discussion depends on how that scalar was arrived at: emitters
read it, the resolve never sees it.

## Statistic attachment — a second, physical-luminance target

The target is MRT. **Attachment 0 is unchanged** — display luminance, same
look. **Attachment 1 is RG16F**, carrying flux-correct luminance in R and
peak-correct luminance in G for the exposure statistic to reduce, and it is
gated per draw so only physical emitters reach it. Why attachment 0 cannot
serve, the texel rule, the blend contract and the residuals are
**`statistic/README.md`**; the reduction itself is
`exposure/reduction/README.md`.

`bind()` clears with the gate open, deliberately: the renderer's own
auto-clear runs after `bind()` returns with the gate shut, so without an
explicit both-attachment clear the statistic would accumulate across frames
forever. It costs a redundant clear of attachment 0.

## Pass ordering — one target, two passes into it

```
hdr.bind()                 → setRenderTarget(rt) + clear both attachments
renderer.render(scene)     → the whole main stack
localDepthPass.render()    → repaints over the same target
hdr.resolve()              → setRenderTarget(null) + fullscreen tone-map
reduction.measure()        → own targets, then back to the canvas
```

`bind()` and `resolve()` are called from `stellata.ts` `animate()` and
must pair. The local depth pass never touches the render target itself,
which is exactly why its repaint lands in the same target for free —
`clearDepth()` in that pass clears the target's depth attachment, not
the canvas's. Depth semantics, core masks, and the log-depth split are
untouched: depth encoding is orthogonal to colour encoding.

`reduction.measure()` runs last and touches neither this target nor the
canvas — it binds its own chain of ever-smaller targets and restores. It
is after the resolve so the measurement never delays the frame it measured
(`exposure/reduction/README.md`).

**The target's depth is 24-bit.** `depthBuffer: true` with
`stencilBuffer: false` gives `DEPTH_COMPONENT24` on WebGL2 (three
r160 `setupRenderBufferStorage`). This is load-bearing — the local
depth pass derives its slice-ratio bound from a 24-bit buffer
(`../local-depth/README.md` § Precision analysis), so switching the
attachment to a 16-bit renderbuffer or a depth *texture* of the wrong
type would silently coarsen every close-range z-test by 256×.

The target is `RGBA16F` plus its `RG16F` statistic attachment
(§ Statistic attachment), sized to the renderer's **drawing buffer**
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
0** — a physical luminance reaching the canvas with no operator would just
blow out. Since the ship gate went live this is genuinely the fallback
path plus the `hdr.setEnabled(false)` A/B, not the shipped default it was
during H3–H5. It mirrors the extinction prepass's
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

## Ship gate — the seam is live

`HDR_DEFAULT_ENABLED` is **true**. Every physical emitter carries
luminance in the § Unit scale — stars (H3), the Milky Way (H4), and the
planet mesh / rings / airlight / reflected glare (H5) — so the target is
the default path and the operator runs once, at the resolve.

- `hdr-pipeline.test.ts` pins the value, so changing it stays deliberate.
- `stellata.hdr.setEnabled(false)` is the whole-frame A/B (§ Dev switches).
  It is no longer "what users get" — it is the comparison path.
- **The target allocates lazily**, on first `bind()` that wants it — a
  full drawing-buffer RGBA16F plus its RG16F statistic attachment and its
  24-bit depth attachment is a couple of hundred MB of VRAM at 2x DPR on a
  large display. The gate
  being live means it now allocates on the first frame in practice; keep
  the laziness anyway, because `hdr.setEnabled(false)` and chart mode both
  want a build that never pays for it.
- **Every emitter is on the scale.** The Local Group emission pass was
  the last one outside it; it now takes the same
  `stellataSurfaceBrightnessLuminance` gain as the band, off a zero
  point derived from the solver's flux units rather than a tuned
  constant (`../local-group/README.md` § Zero free parameters).

## Dev switches

- `stellata.hdr.setEnabled(true/false)` — the seam itself. False is the
  pre-HDR compositing path entirely: no target, no tone-map, chrome back
  to authored colours, every emitter on its inline operator. It is also
  the path hardware without a float-renderable target takes. **This is
  the full A/B.**
- `stellata.hdr.setTonemapEnabled(false)` — keeps the target bound but makes
  the resolve straight pass-through, isolating the target itself (depth,
  alpha, blend precision, pass order) from the operator.
- `stellata.hdr.setDynamicRangeMag(x)` / `stellata.hdr.setHighlightDesat(x)` — the
  operator's two shape knobs, live, for probing the display axis by eye.
  Both route through `syncMode`, which is what re-authors every chrome
  colour against the new white point (`chrome/README.md`).

**What `DR_MAG` does and does not buy.** Extended Reinhard is
`L(1 + L/Lw²)/(1 + L)`, which is already at 0.95 of full scale by `L` = 20
*whatever* `Lw` is — so raising `DR_MAG` buys hue survival at the top end
and almost no visible gradient. Detail up there needs a longer
**shoulder**, not a higher white point, and any replacement curve must
stay analytically invertible: `tonemap-pure.ts` carries the exact inverse
and `chrome/` depends on it, which rules out ACES and filmic fits. A
piecewise log shoulder is invertible; that is the shape to reach for.

**Pass-through shows the scene blown out, and that is the point of it** —
`uHdrTarget` stays 1, so every emitter writes raw linear `L` (tens to
thousands) and the resolve hands it to an 8-bit canvas unchanged.

**It also cannot reproduce built-in-material chrome, by construction.**
What disables their `colorspace_fragment` encode is the target's linear
colour space, not the resolve — so with the operator parked,
`LineBasicMaterial` / `LineMaterial` chrome (grids, orbit paths, the
constellation figure) renders un-encoded and therefore dark. No resolve
setting fixes it: a single fullscreen pass can't both encode and not
encode. Custom-shader chrome *is* exact. Use `hdr.setEnabled(false)` when
you want a whole-frame comparison.

**What the A/B is and is not for.** It compares *compositing*, not
calibration (§ Fallback), so it cannot reveal a mis-calibrated emitter —
only accumulation and blend-order differences.

**Expected on the A/B, and not a bug: chrome line work reads visibly
brighter with the seam ON.** Grids, the galactic coordinate sphere, orbit
rings and binary paths are authored colours pre-mapped through the
operator's inverse, and § Chrome's mapping is exact only for *a lone
full-alpha fragment over black*. Line work is neither — antialiased edges
are partial-alpha, and lines cross each other — so the round trip does not
return them to authored, and the residual lands on the bright side. The
"slight look shift accepted in H2" wording undersells it; the shift on thin
line work is plainly visible. Nothing downstream depends on it, and no
resolve setting fixes it.

Neither switch is bit-identical to a pre-HDR build, for two further
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
§ GPU timing.

## Not here yet

`DR_MAG` and the desaturation strength are live **dev-console** setters
(§ Dev switches); H8 puts them on the panel, alongside `L_THRESH`, which
is still baked. `DR_MAG` is also the faint-end lever H7 tunes against the
eso0932a panorama — it moves the star field and the Milky Way band
together, which is the point of it.

No emitter is outside the scale, and both volumetric emitters now share one
zero point (`SB_ZERO_POINT`) instead of deriving their own. Still outstanding
*upstream* of the unit: the Milky Way's emissivity is anchored on one
corrected sightline, not a total luminosity — `../milkyway/README.md`.
