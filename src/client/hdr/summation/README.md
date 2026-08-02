# Rod summation — convolve the diffuse emitters, then gain

The eye does not detect an extended source pixel by pixel: rods sum over a
critical area, so threshold for anything larger than that area is a
**surface brightness** (`../emission/README.md` § Extended sources). Turning
that into a display level means averaging the emission over the summation
patch and gaining by the patch area — and the average is what this folder
owns. `docs/science-hdr-pipeline.md` § 1 is the design gate.

Substituting `Ω_sum` for `Ω_px` *without* the average is the same operation
only for a source uniform across the patch. The Milky Way band from Sol is;
M31 is not, and reusing the band's gain on it over-lifts the nucleus by
3.95 mag. Averaging first makes the uniformity assumption true by
construction, so **both layers take the same anchor and both become
FOV-invariant** — and the resolution loss the eye actually applies comes
along, which is why naked-eye M31 is a smudge.

```
src/client/hdr/summation/
  summation-pure.ts          Patch radius in px, the downsample factor that
    (+ test)                 bounds the tap count, the disc's area-overlap
                             weights, and the CPU mirror of the
                             convolution. The test is the epic's acceptance
                             for this pass (§ What is pinned).
  summation.glsl             The convolution as a shared chunk
                             (stellata_summation), pasted into the resolve.
  summation-downsample.frag  Box-average of the diffuse attachment, so the
    .glsl                    kernel spans a bounded number of texels.
  summation-pass.ts          SummationPass — the downsample target's
    (+ test)                 lifecycle, the per-frame factor choice, and
                             the uniforms it hands the resolve.
```

## Where it sits in the frame

The diffuse emitters write **attachment 2** of the HDR target rather than
attachment 0: their pre-summation display luminance, per arcsec² gained by
`Ω_sum`. Attachment 2 rather than a target of its own for three reasons,
each of which a separate pass would break — the band's `depthTest` against
close star cores, the additive accumulation of the two Milky Way meshes and
of M31's overlapping disc and bulge, and the existing pass order
(`../README.md` § Pass ordering).

```
hdr.bind()             → clear all three attachments
renderer.render(scene) → diffuse emitters land in attachment 2, everything
                         else in attachment 0; both still write attachment 1,
                         and the absorbers multiply attachments 0 and 2
summation.render()     → box-downsample attachment 2 when the factor is > 1
hdr.resolve()          → attachment 0 + Σ(attachment 2 over the patch),
                         then the operator, at alpha 1
```

## Where each absorber acts

A layer that leaves attachment 0 also leaves the blend chain everything drawn
in front of it composites against, and depth ordering says nothing about that.
Two consumers operate on the diffuse emitters, and both have to follow them:

- **Molecular-cloud absorption** (`renderOrder` −2, against the emitters'
  −3) is a premultiplied `rgb = 0` multiply, so it is `markAbsorber` →
  `[0, NONE, 2]`: one blend equation covers every attachment, so the same
  alpha-only texel dims both. Extinction lands **before** the convolution,
  which is the physical order — light is absorbed in interstellar space and
  the eye sums what survives. Keeping attachment 0 costs nothing and leaves
  any future far-field opaque emitter extincted.
- **The canvas alpha.** The resolve writes **1**, not attachment 0's: a
  diffuse fragment masks attachment 0 off, so its alpha is the clear's zero
  while its rgb is the whole band, and a premultiplied canvas composites
  `rgb > a` as nothing.

The absorber mark inverts the gate's usual safety — a mesh that forgets it
merely stops absorbing, with no error and no missing draw, so
`../../molecular-clouds/molecular-clouds.test.ts` pins the only call site
alongside the shader's `location = 2` declaration.

**The gain does not move**, and that is deliberate: attachment 2 carries the
same `Ω_sum`-gained value the band used to write into attachment 0, so the
convolution is a plain mean of it. A mean over a *uniform* field returns
that field exactly, which is why the band's shipped display table from Sol
(`../../milkyway/README.md` § The gradient this produces) is preserved by
construction rather than to some tolerance. Carrying un-gained flux instead
would put the band's texels at ~4e-8 — fp16 subnormal range, and quantised
to nothing.

**The statistic never sees any of this.** Attachment 1 stays on `Ω_px` in
both channels, unblurred: the adaptation model reads retinal illuminance,
not the display concession (`../attachments/README.md`).

## The kernel — a flat disc, and it has to be

`summationWeight` is the fraction of each texel inside the patch, a linear
ramp across the last texel. Two rejected alternatives, both measured:

- **A separable Gaussian of matched σ does not converge.** It sits 0.43 mag
  off at 10° FOV and stays 0.30 mag off even when the patch spans 97 px —
  it is a different operator, not a cheap disc. This is what forces a
  non-separable kernel and therefore the downsample below.
- **Hard thresholding** the same disc is 4x worse at the same tap count
  (0.072 mag against 0.018 at a 4-texel radius). The ramp matches exact
  circle-square overlap to 0.001 mag.

**`summationRadiusPx` is in CSS pixels and every texel here is a
drawing-buffer pixel.** `Ω_px` is a CSS solid angle on purpose — brightness
must not track `devicePixelRatio` — so `SummationPass` multiplies by the
renderer's pixel ratio before choosing a factor. Miss that crossing and the
kernel is `pixelRatio` times too small, which reads as the convolution
quietly doing nothing on a retina display.

`summationDownsample` is what keeps a non-separable kernel affordable while
the patch's radius spans 0.8 px at 120° FOV to tens of px at 10° on a tall
viewport: the source is box-averaged until the kernel is ~3 texels, so the
tap count is bounded at every FOV instead of growing quadratically.
`MAX_KERNEL_REACH_TEXELS` is the GLSL loop bound this buys, and the
downsample target is sized to the *widest* factor the pass will use, with
each frame rendering into the sub-rect it needs — so a zoom never
reallocates.

## Footprint — the half the convolution cannot do

A convolution can only average what the rasteriser sampled. A raymarch
point-samples its profile at the pixel centre, so an aliased Sérsic cusp
survives the convolution intact — which is why the footprint softening in
`../emission/README.md` § Footprint is a prerequisite for this pass rather
than an independent nicety. With it, the residual at M31's nucleus is
0.01–0.15 mag across the whole FOV range; without it, 1.4–3.1 mag.

## What is pinned

`summation-pure.test.ts` carries the acceptance, all of it measured against
*average-then-gain over the true profile* — an ideal with no free
parameter, since `10^(−0.4·S̄)·Ω_sum` **is** the patch flux:

- M31's envelope lands within 0.11 mag at every reachable FOV, against a
  0.8–6.2 mag under-lift under the retired per-layer `Ω_px` opt-out.
- M31 and the band respond to FOV **the same way** — both invariant.
- A uniform field comes through bit-unchanged, at every factor.
- The Galaxy at 2 Mpc and a Local Group object of the same surface
  brightness at the same distance land on the same level.
