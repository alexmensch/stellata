# The tone-map operator

The curve that maps scene luminance to the canvas, the fullscreen
resolve that runs it, and the CPU mirror plus exact inverse.
`../README.md` owns the target, the attachments and the pass ordering;
this folder owns the transfer function they resolve through.

The operator is a **two-consumer** shape: the fullscreen resolve runs it,
and so does every emitting graph inline whenever `uHdrTarget` is 0 — chart
mode ([The inline operator](../README.md#the-inline-operator--chart-modes-path)). One source, so the two can
never drift.

## Files

```
src/client/hdr/tonemap/
  tonemap-pure.ts (+ test)   CPU mirror of the operator plus its exact
                             inverse. Vitest-pinned against the design
                             doc's worked values. Also the codebase's
                             shared sRGB transfer pair and Rec.709 luma
                             weights — ~44 modules across src/ and
                             scripts/ import from it.
```

The shipped operator is `../../webgpu/tonemap-tsl.ts`, run by
`../../webgpu/hdr/hdr-pipeline-webgpu.ts`'s resolve; the dither's
interleaved gradient noise is `../../webgpu/tsl/jitter-tsl.ts`
(§ One hash). All three import their constants from `tonemap-pure.ts`.

## Operator

Faint-end toe, then luminance-domain extended Reinhard, hue-preserving,
then highlight desaturation, then sRGB encode, then dither — all in
`tonemapTsl` so the fullscreen resolve and the inline path can never
drift.

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
above `L_THRESH`, so every anchor holds, and it leaves the knee with
**slope 1** (C1): a source `m` magnitudes under threshold displays
`m + TOE_CURVATURE·m²` magnitudes under it, the coefficient derived so
exactly `TOE_BLACK_MAG` under lands on half an 8-bit step. The C1 knee
is load-bearing, not taste: the first cut was a fixed-exponent power
(slope 3.5 at the knee), and that kink projected a visible isophote
onto every smooth gradient crossing threshold — hard-edged molecular
clouds, banded EV sweeps. Sub-threshold light does not render at its
near-linear Reinhard value; the Milky Way pole is the
motivating case ([The gradient this produces](../../milkyway/calibration/README.md#the-gradient-this-produces-and-what-it-reads-on-screen)).
Exactly invertible, and `inverseTonemapConstant` composes the inverse so
dark-authored chrome round-trips (`../chrome/README.md`). The design
argument — and why a rendered sky-background pedestal was rejected — is
[§ 2](/docs/science-hdr-pipeline.md#2-tone-map-operator).

Two testing consequences of what [§ 2](/docs/science-hdr-pipeline.md#2-tone-map-operator) says
about hue and clipping: hue survival is pinned in `tonemap-pure.test.ts`,
and end-to-end luminance preservation above the knee is **not** a property
of the pipeline, so don't assert it — desaturation is luminance-neutral
pre-clamp only.

**`tonemapUnditheredTsl` is the variant an overlapping emitter
wants.** The dither is a function of `fragCoord` alone, so it is the
same offset for every fragment landing on a pixel; N additively-blended
star quads would add it N times — a coherent brightness bias over dense
fields, not noise that cancels. Anything covering each pixel once (the
resolve, a fullscreen volume) wants the dithered `tonemapTsl`.
`tonemap-pure.ts` mirrors the undithered variant.


## One hash

`interleavedGradientNoiseTsl` is the interleaved gradient noise every
layer that jitters rides — the operator's ±0.5-LSB output dither here, the
ray starts of both molecular-cloud raymarches, and the atmosphere march's
sample lattice. One helper, over `DITHER_IGN_SCALE` / `DITHER_IGN_DOT` in
`tonemap-pure.ts` ([Interleaved gradient noise](../../webgpu/tsl/README.md#interleaved-gradient-noise)),
so no layer carries a private copy of the expression or its
constants.

## Operator knobs

- `stellata.hdr.setTonemapEnabled(false)` — keeps the target bound but makes
  the resolve straight pass-through, isolating the target itself (depth,
  alpha, blend precision, pass order) from the operator.
- `stellata.hdr.setDynamicRangeMag(x)` / `stellata.hdr.setHighlightDesat(x)` — the
  operator's two shape knobs, live, for probing the display axis by eye.
  Both route through `syncMode`, which is what re-authors every chrome
  colour against the new white point (`../chrome/README.md`). Both are also
  sliders on the panel's Exposure section
  ([Debug panel](../exposure/README.md#debug-panel)), and `DR_MAG` reaches the display
  floor from there — the floor is derived from the white point.

**What `DR_MAG` does and does not buy.** Extended Reinhard is
`L(1 + L/Lw²)/(1 + L)`, already at 0.95 of full scale by `L` = 20
*whatever* `Lw` is — so raising `DR_MAG` buys hue survival at the top end
and almost no visible gradient. Detail up there needs a longer
**shoulder**, and any replacement must stay analytically invertible
because `../chrome/` inverts it; a piecewise log shoulder is the shape to
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
encode. Custom-shader chrome *is* exact. No switch renders a whole-frame
comparison instead — [The inline operator](../README.md#the-inline-operator--chart-modes-path) says why one
would compare against a differently-calibrated scene.

**Chrome line work reads brighter through the seam than authored, and that
is not a bug.** [Chrome](../README.md#chrome--non-physical-layers-keep-their-authored-look)'s inverse mapping is exact only for
*a lone full-alpha fragment over black*, and line work is neither —
antialiased edges are partial-alpha and lines cross each other — so the
round trip lands on the bright side. The shift on thin line work is plainly visible, nothing
downstream depends on it, and no resolve setting fixes it.

Pass-through is not bit-identical to a pre-HDR build, for two further
reasons worth knowing before chasing a diff:

- Blending intermediates do not round-trip through 8 bits, so faint
  gradients differ by up to a quantisation step.
- Additive accumulation clamped at 1.0 per draw on the canvas; in fp16
  it accumulates past 1.0 and clamps once at the resolve. Additive and
  max blends are unaffected (both are clamp-commutative), but a
  region that additively saturated to white *before* a later
  alpha-blended draw composites differently.

Two inherent limits on the chrome mapping — exactness only for a lone
full-alpha fragment over black, and linear-space blending — are
`../chrome/README.md`'s.
