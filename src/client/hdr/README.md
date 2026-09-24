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
  hdr-emitter-uniforms.ts    The six slots every physical emitter binds by
                             reference (§ Unit), the picker that lifts them
                             out of the shared map, and the attachment
                             contract the seam's target carries
                             (§ Three attachments).
  hdr-seam.ts                The interface the shell holds; the pipeline
                             behind it is src/client/webgpu/hdr/, past the
                             import boundary.
  attachments/               The attachments past 0: the per-draw gate
                             every one of them goes through, and what may
                             write the statistic, in what unit — its own
                             README.
  tonemap/                   The operator: the CPU mirror + exact
                             inverse, where the shared graph and the
                             fullscreen resolve live, and the two shape knobs — its own
                             README (§ Operator).
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
arcsec² (`pixelSolidAngleArcsec2`), written by the pipeline's
`setPixelSolidAngle` from `angularToPx(viewportHeightCssPx, fovYRad)`. A layer needing the plate scale back — the Local Group's
resolution floor — inverts it through `pxPerRadianTsl` rather than
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
disc's `r_phys_px` grows as FOV shrinks. The *display* path does not
follow it: the eye's summation area is angular, so a diffuse source holds
its level at any plate scale ([Extended sources](emission/README.md#extended-sources--two-solid-angles-one-write-tail)). The
statistic keeps the quadratic fall; an unresolved point keeps its peak at
any FOV.

The pipeline's `emitterUniforms` is how a layer binds to this. Six
uniforms, held **by reference** so one write reaches every pass:
`uExposure`, `uOmegaSummationArcsec2`, `uOmegaPxArcsec2`, `uWhitePoint`,
`uHighlightDesat`, and
`uHdrTarget` — the 0/1 branch telling the shader whether to emit raw `L`
or run the operator itself. The pipeline owns every write to
`uHdrTarget` (via the same `wantsTarget()` the chrome mapping reads, so
the chart bypass reaches emitters for free); layers only read. The
resolve pass shares the white-point and desaturation objects, so inline
and fullscreen can never disagree.

## Exposure — two slots this class does not write

`uExposure` and `uOmegaSummationArcsec2` are the `emitterUniforms` slots
the pipeline never writes: both are instrument-derived, so
`ExposureController` owns them along with the three magnitude bounds
(`uLimitMag`, `uThresholdMag`, `uCullMag`). `exposure/README.md` is the
contract, and it is where the per-frame adaptation measurement lives too.
Nothing in this README's operator or target discussion depends on how
those numbers were arrived at: emitters read them, the resolve never sees
them.

## Three attachments, and a per-draw gate on two of them

The target is MRT. **Attachment 0** is display luminance, from every emitter
that draws a kernel or a surface. **Attachment 1 is RG16F**, carrying
flux-correct luminance in R and the lit-surface coverage mask in G for the
exposure statistic to reduce. **Attachment 2** is the volumetric emitters' own: their
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
[Everything that dims the field](summation/README.md#everything-that-dims-the-field-has-to-follow-it-here) is the statement, and
the canvas alpha is the consumer with no mark of its own.

The render pass's own clear writes every attachment, so both extra
attachments read zero at the start of every frame, never stale.

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

**The target's depth format is load-bearing, and it has to be stated
rather than inferred.** The local depth pass derives its precision
guarantee from the format ([Precision analysis](../local-depth/bracket/README.md#precision-analysis)):
the K = 1 bound assumes float32.

`reversedDepthBuffer` makes three pick `depth32float` for the CANVAS
only; for a render target it auto-creates a `depth24plus` depth texture
regardless, which is fixed-point and makes a single bracket wrong by
~262 AU at Neptune's ring. So `WebGpuHdrPipeline` attaches an **explicit
`FloatType` `DepthTexture`** — a request, and why nothing can confirm it
landed is [The depth format is requested, not asserted](../webgpu/hdr/README.md#the-depth-format-is-requested-not-asserted).

Adding stencil breaks it: it diverts the target to
`depth32float-stencil8`, an optional device feature.

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

The transfer function itself — the faint-end toe, the extended Reinhard,
the constants table, the exactly-invertible round trip chrome depends on,
and the two shape knobs — is **`tonemap/README.md`**, along with where the shared graph, the
resolve and the CPU mirror live.

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

The pipeline's `syncMode` is what drives that second point: every state
change (both dev switches, the chart flip) routes through it, and it
re-authors every registered colour when the operator parks.

## Chart mode — full bypass

Chart renders direct to the canvas: no target, no tone-map, no exposure,
and pixel-identical to the pre-HDR build. Why a bypass rather than an
identity path is [§ 5](/docs/science-hdr-pipeline.md#5-chart-mode--full-bypass).

`setMonochrome` is the seam (`stellata.ts`), alongside the existing
paper clear-colour swap. `applyTheme('mono')` is the only caller, so
mono and chart are the same state in practice.

Entering or leaving chart swaps every MRT material between its
single-output graph and the three-member struct
([The gate becomes the output struct](../webgpu/hdr/README.md#the-gate-becomes-the-output-struct)), which
rebuilds those pipelines. That is a one-time hitch on the chart
transition, which already swaps materials anyway.

## The inline operator — chart mode's path

**A converted layer applies the operator itself whenever `uHdrTarget` is
0** — a physical luminance reaching the canvas with no operator would just
blow out. That is why the operator lives in a shared helper rather than
inside the resolve alone, the same two-consumers strategy as the
extinction prepass ([The prepass cache](../star-pipeline/extinction/README.md#the-prepass-cache)).
**Chart mode** is what reaches it, and nothing else does.

**This path is not a calibrated build.** A point source is fine — same
`L`, same operator, same exposure, and the **peak matches exactly**. A
*diffuse* source is not: there is no attachment 2 and no pass to convolve
it, so the extended-source anchor is gone entirely and both volumetric
emitters revert to the pixel solid angle ([Extended sources](emission/README.md#extended-sources--two-solid-angles-one-write-tail)),
which puts the band and the Local Group **several
magnitudes faint**. So it is not a comparison path for the colour frame:
parking one here would compare against a differently-calibrated scene.

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
Local Group glow — so the target is the path, and nothing can take it away.
No switch reaches past it: `wantsTarget()` is `!chart`, and
`hdr-pipeline-webgpu.test.ts` pins that behaviourally, so a second input has
to be a deliberate edit.

- **The target allocates lazily**, on first `bind()` that wants it — a
  full drawing-buffer RGBA16F plus its RG16F statistic attachment, its
  second RGBA16F and its float32 depth attachment is a couple of hundred MB
  of VRAM at 2x DPR on a large display. It allocates on the first frame in
  practice; keep the laziness anyway, because a session that stays in
  chart mode never pays for it.
- **Every emitter is on the scale.** The Local Group emission pass was
  the last one outside it; it takes the same
  `surfaceBrightnessLuminanceTsl` gain as the band, off a zero
  point derived from the solver's flux units rather than a tuned
  constant ([Zero free parameters](../local-group/emission/README.md#zero-free-parameters--the-emission-scale-is-derived)).

## Dev switches

The target's own levers. The operator's — `setTonemapEnabled` and the two
shape knobs, plus what pass-through does and does not reproduce — are
[Operator knobs](tonemap/README.md#operator-knobs).

- `stellata.hdr.setStatisticWritesEnabled(false)` — masks attachment 1 out of
  every emitter draw while the clear keeps writing it, so the statistic reads
  zero rather than stale and the reduction keeps running over an empty
  attachment. A frame-cost lever
  ([The roster](../debug/frame-cost/passes/README.md#the-roster)); live, with the
  cut not held, it fades the adaptation to zero.
- `stellata.hdr.setSummationEnabled(false)` — skips the rod-summation
  downsample and collapses the resolve's kernel to one centre tap. The band
  keeps its level (the uniform-field identity); M31 sharpens. Frame-cost
  lever.
- `stellata.hdr.setSummationTapsEnabled(false)` — the finer half of that
  split: the downsample still runs (and still picks the factor), only the
  resolve's off-centre taps drop. Its row prices the kernel's taps alone;
  `summation` minus it is the downsample. The band keeps its level here
  too — the centre tap of a box-averaged uniform field is the field.
- `stellata.hdr.setExtraAttachmentsEnabled(false)` — rebuilds the target with
  attachment 0 alone, the MRT-vs-single-target cut: the statistic parks (hold
  `reduction.fenceWhileParked` across it, as the chart park does) and every
  diffuse write discards, so the band and the Local Group vanish for the
  span. Reallocates the target both ways. Frame-cost lever.

Perf row: `submit.tonemap` (CPU submission, `../debug/README.md`). It
includes the summation downsample and the convolution's taps, since
`resolve()` runs them; only `gpu.frame` prices the pass's GPU cost.
[The kernel](summation/README.md#the-kernel--a-flat-disc-and-it-has-to-be) is where the tap count is bounded.

## Not here yet

`DR_MAG` and the desaturation strength are on the panel as well as the
dev console ([Operator knobs](tonemap/README.md#operator-knobs)); `L_THRESH` and the
extended-source threshold
appear there as **readouts, never sliders** — `L_THRESH` is the unit's own
anchor, so a slider on it would move every layer's calibration with it
([Debug panel](exposure/README.md#debug-panel)). **`DR_MAG` has no leverage
on the band's faint rows** — `y/Lw²` is under 2 × 10⁻³ there, so
sweeping it 5.5 → 11 moves them under 0.01 mag
([§ 8](/docs/science-hdr-pipeline.md#8-validation-contract-h7)). It works at the top end, on star
peaks and hue survival — 7.5 is validated there, not against the
panorama, and the faint end belongs to the two thresholds and the toe.

No emitter is outside the scale, and both volumetric emitters share one
zero point (`SB_ZERO_POINT`) and one ρ₀ solve
([Solving ρ₀](emission/README.md#solving-ρ--a-published-magnitude-into-an-emitters-density)). The band is anchored on the Galaxy's
integrated M_V now; where that leaves it against the sightline photometry
is [Two checks](../milkyway/calibration/README.md#two-checks-and-both-disagree-by-the-same-sign-and-order).
