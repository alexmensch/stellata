# The statistic attachment — what the exposure is allowed to see

The HDR target's second colour attachment, and the one call that lets a
mesh write into it. `../README.md` owns the target's lifecycle;
`../exposure/reduction/README.md` reduces what lands here;
`../exposure/README.md` owns what the two reduced numbers then do.

```
src/client/hdr/statistic/
  statistic-attachment.ts   markStatisticEmitter (the per-draw gate a
                            physical emitter binds to) and the seam
                            HdrPipeline drives it through.
```

## Why attachment 0 cannot serve

The exposure statistic reduces what the frame drew rather than walking a
per-source model, which is what lets it see airlight, ring annuli,
twilight and every future emitter. It cannot do that over the display
target. Three reasons, each on its own fatal:

- **The display kernel preserves peak, not energy.** A star's quad is
  `max(appSize, physSize)` wide while its flux belongs to `π·r_phys²`, so
  a mean over attachment 0 over-counts a threshold star's flux by 1.96x
  and a knee-saturated bright one by **28.9x** (+3.7 mag). Sol at 100 AU —
  the case the flux-based star gate exists for — is the 28.9x row, and the
  error lands on the branch that governs. The factor also rides
  `kMultiplier`, a debug legibility slider.
- **Chrome is in there.** Grids, both coordinate spheres, constellation
  figures and boundaries, orbit and binary paths, probe markers, fresnel
  and cloud rim shells all render into the target with authored colours
  inverse-mapped through the operator. A mean would count switching on the
  equatorial sphere as ~0.3 mag of scene light, and a full-white chrome
  line inverse-maps to `L` = 20 — above `L_CAP`, so it would corrupt the
  peak too.
- **The mean and the max want different normalisations** of the same
  light, and one channel cannot carry both.

## The unit

```
R = flux-correct luminance   → reduce MEAN → L̄
G = peak-correct luminance   → reduce MAX  → peak_max
```

`stellataStatisticTexel` (`../emission/emission.glsl`) is the texel rule. Both
channels clamp at `LUMA_CEIL`, for the reason the display peak does: a
clamped read is a lower bound the adaptation loop closes from above
(`../exposure/reduction/README.md` § Measure at the base exposure).

**An extended source has `R = G`** — its emission is already true surface
brightness, so its flux over the pixels it covers is what a mean wants.
Both are computed at the **pixel** solid angle even where attachment 0 is
not: the Milky Way band displays at the eye's rod summation area
(`../README.md` § Extended sources), and that lift is a display
concession rather than light, so it must not reach a channel the
adaptation model reads as retinal illuminance. What this channel therefore
sees from the band's brightest sightline at the base epoch is
`L` = 1.657e-3 — **10.1 stops under `L_CAP` 1.8**, so no cut can originate
here (the 0.02 the band *displays* at never reaches this channel, which is
the point). Pinned in `milkyway.test.ts`.

**A point source does not.** Its R divides the display kernel by the
kernel's own area integral, `Φ(n)·D²`, where Φ is
`perceptualDiscFluxIntegral` (`../../star-pipeline/perceptual-disc.glsl`, a
degree-4 fit in 1/n good to 0.0029 mag) and `D` is the quad's **CSS**
diameter. `stellataKernelFluxPeak` is that renormalisation, and it is
computed per instance in the vertex stage because the exponent morphs on
`vSoftness` and `vPhysRatio`, both of which are per instance. CSS rather
than device pixels is what keeps the frame mean
`devicePixelRatio`-independent — `../exposure/reduction/README.md`
§ Pixel units carries the arithmetic.

## The gate — chrome is safe by default

The target binds with `drawBuffers [0, NONE]`, and only a mesh passed to
`markStatisticEmitter` flips attachment 1 on for the span of its own draw.
Nothing else can reach the statistic, **including a chrome layer added
later** — which is the opposite failure mode from patching ten chrome call
sites and hoping the eleventh remembers.

Two things the gate has to get right:

- **It is unbound whenever no MRT framebuffer is current.** `drawBuffers`
  on the default framebuffer accepts only `BACK` or `NONE`, so an emitter
  hook firing on the canvas path — chart mode, the float-RT fallback, the
  `hdr.setEnabled(false)` A/B — would be a GL error rather than a no-op.
- **The resting state is restored on the way out of every draw**, so a
  mid-frame re-bind of the target cannot leave the gate open behind it.

`markStatisticEmitter` composes with whatever hooks the object already
carries, so it is order-independent against a layer that wants its own.

## One blend equation, two attachments

WebGL2 has no per-attachment blend state, so the blend an emitter chose for
its colour runs over its statistic texel too. **Each emitter's alpha on
attachment 1 is therefore part of its contract, not a free slot.**

- **Additive passes** (star glow, planet glare, the Milky Way band) blend
  `SrcAlpha × One` because their materials are not premultiplied. They
  write alpha **1** on attachment 1 and pre-divide: the flux channel must
  be summed once, not scaled by the kernel a second time. Write the display
  kernel's own alpha there instead and the integral comes out short by
  `∫glow² / ∫glow`.
- **Per-channel-max passes** (the star disc) ignore alpha entirely.
- **Alpha-composited passes** (the planet mesh, ring annuli) mirror
  attachment 0's alpha exactly, so the LOD crossfade composites both alike.
- **The atmosphere shell composites premultiplied-over**, the one blend
  whose source factor is `One`, so `uFade` has to ride the channels as well
  as the alpha.

## Known residuals

- **The disc pass takes a max, not a sum.** `MaxEquation` means attachment
  1's flux channel under-counts where two resolved discs overlap. Rare
  (close resolved stars) and small; documented rather than fixed.
- **Absorption layers write no texel.** Molecular-cloud absorption dims
  attachment 0 but leaves the statistic reading the Milky Way band
  un-extincted. Inert: the band sits two decades under the adaptation
  anchor and cannot produce a cut on its own.
- **A point source's G over-reads in the kernel's wings** under an additive
  blend, because alpha 1 drops the second `glow` factor attachment 0 gets.
  Exact at the peak, which is the only place a frame `max` reads it.
- **A ring annulus extinguishes at face-on opacity.** A rasterised fragment
  carries no opening angle, so the slant-path term the source walk applied
  analytically — `T = (1 − α)^(1/|sin B|)`, opaque edge-on — is gone. It
  under-dims a source seen through a near-edge-on ring; edge-on is also
  where the zero-thickness annulus thins to a line and covers almost no
  texels, so the case it matters in is the case it barely arises in
  (`../../solar-system/planets/rings/README.md`).
