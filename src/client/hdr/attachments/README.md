# The target's extra attachments — who may write them

The HDR target's attachments past 0, and the per-draw gate deciding which of
them a given mesh reaches. `../README.md` owns the target's lifecycle;
attachment 1's unit and residuals are here; attachment 2's contract is
`../summation/README.md`'s; `../exposure/reduction/README.md` reduces
attachment 1 and `../exposure/README.md` owns what the two reduced numbers
then do.

```
src/client/hdr/attachments/
  attachment-gate.ts        The per-draw gate on every attachment past 0 —
    (+ test)                one mark per role (§ The gate) plus the seam
                            HdrPipeline drives it through.
  statistic-mask.test.ts    Which emitters may claim lit-surface coverage,
                            read off the shader sources (§ The unit).
```

**The mark a layer calls is its whole declaration of how it stands to the
light already in the target**, and nothing else may touch `drawBuffers`.
§ The gate is that table: a new layer picks a row, and a layer that fits no
row adds one there rather than reaching for the GL call itself.

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
  line inverse-maps to `L` = 20 — 300x the perception branch's own anchor,
  so it would corrupt the mean outright.
- **A display target has no idea what is a resolved surface.** The mask
  below is a declaration each emitter makes, not something a threshold on
  luminance could recover — a bright star's core and a dim planet's disc
  overlap in level, and the band is in the same frame.

## The unit

```
R = flux-correct luminance     → reduce MEAN → L̄
G = lit-surface mask ∈ [0, 1]  → reduce MEAN → coverage, and R×G → S̄
```

**The mask is a fraction, not a flag.** A surface that alpha-composites
writes 0 or 1 and lets the one blend equation scale it; one compositing
premultiplied has to arrive pre-scaled, so it writes the fraction itself.
Both land the same number in the buffer.

`stellataStatisticTexel` (`../emission/emission.glsl`) is the texel rule. R
clamps at `LUMA_CEIL`, for the reason the display peak does: a clamped read
is a lower bound the adaptation loop closes from above
(`../exposure/reduction/README.md` § Measure at the base exposure).

**G carried peak-correct luminance until the highlight guard retired.** The
guard was its only consumer, and for a resolved surface R and G were the
same number anyway — so the channel was already redundant where it mattered
most. It now carries the coverage term the exposure pin divides by
(`../exposure/README.md` § Adaptation), which is why that fix cost no
memory and no extra pass.

**Which emitters may claim coverage is part of the contract, and it is
pinned** (`statistic-mask.test.ts`) — and **zero for everything that draws a
kernel or a diffuse column**: stars, planet glare, both volumetric
emitters. A texel counted as coverage without light in R pulls `D` down and
over-exposes the surface the pin holds; light in R without coverage inflates
it. The night side is the case big enough to matter — geometric coverage
would halve `D` at full phase and gut it on a crescent.

**Every claimer gates on its own illumination, not on its geometry**, and
each of the three has a different dark region to exclude:

| emitter | claims | the dark region it excludes |
| --- | --- | --- |
| planet mesh | its **lit hemisphere** — `step(0, sunCos)·step(0.5, shadow)` | the night side, and an eclipsed surface |
| ring annulus | the **sunlit strip** — `step(0.5, lit)` | the band in the planet's shadow, and the whole annulus as the sun crosses the ring plane |
| atmosphere shell | opacity × **`litFrac`** | the night-limb chord, which is the dense one — it occludes fully while scattering nothing toward the eye |

The two non-mesh rows are the ones geometry gets wrong the hardest, because
neither dark region shrinks when the lit one does. Saturn's annulus is
~3.6x the globe's own disc area face-on, so a shadowed band outvotes every
other coverage term in the frame; and a shell's night limb is a constant
share of the disc whatever the phase, so a crescent that halves the mesh's
claim leaves the shell's untouched — Earth's 100 km shell is ~3 % of its
disc area and rounds away, Titan's 300 km on 2575 km is ~25 % and
near-opaque, which renders a crescent multiples too bright.

**An extended source's R is its true surface brightness**, computed at the
**pixel** solid angle and **unconvolved**: a
volumetric emitter's display value goes to attachment 2 gained by the eye's
rod summation area and averaged over it (`../summation/README.md`), and that
whole path is a display concession rather than light, so none of it may reach
a channel the adaptation model reads as retinal illuminance. A normalised
convolution conserves total flux anyway, so the mean the reduction takes
would barely move — the reason to keep it out is the unit, not the size of
the error. What this channel therefore
sees from the band's brightest sightline at the base epoch is
`L` = 1.657e-3 — **3.5 stops under `L_ADAPT`**, so no cut can originate
here (the 0.02 the band *displays* at never reaches this channel, which is
the point), and it writes no mask, so it can never reach the pin at all.
Pinned in `milkyway.test.ts`.

**A point source's does not.** Its R divides the display kernel by the
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

The target binds with `drawBuffers [0, NONE, NONE]`, and only a mesh passed
to one of the marks below flips anything else on for the span of its own draw.
Every state resolves through one table, `gateDrawSlots`, which is also where
`HdrPipeline`'s two frame-cost masks apply (`../README.md` § Dev switches) —
the adaptation park rides the statistic mask through its own flag, ANDed in
so neither restore can clobber the other
(`../exposure/README.md` § Parking the measurement).
Nothing else can reach the statistic, **including a chrome layer added
later** — which is the opposite failure mode from patching ten chrome call
sites and hoping the eleventh remembers.

On WebGPU the same table is expressed in node-material terms — output
structs whose masked slots write the blend's identity element
(`src/client/webgpu/hdr/README.md` § The gate becomes the output
struct); everything below is the WebGL2 mechanism.

**Which mark a layer calls is part of its contract**, not a detail:

| mark | opens | for |
| --- | --- | --- |
| `markStatisticEmitter` | `[0, 1, NONE]` | a point emitter: stars, planet glare, airlight |
| `markDiffuseEmitter` | `[NONE, 1, 2]` | a volumetric emitter |
| `markAbsorber` | `[0, NONE, 2]` | a draw that only dims: molecular-cloud absorption |
| `markOccludingEmitter` | `[0, 1, 2]` | an emitter drawn in FRONT of the diffuse field |

- **A volumetric emitter masks attachment 0 off**, because on-target the
  resolve owns that pixel once it has averaged attachment 2 over the summation
  patch (`../summation/README.md`). The mark and the shader's
  `layout(location = 2)` are one decision — either alone fails silently,
  discarding the diffuse write in one direction and leaving attachment 2
  undefined for every other draw in the other.
- **An absorber keeps attachment 0** because nothing else may assume that
  attachment is empty behind it, and needs attachment 2 because that is where
  the light it dims now is. Attachment 1 stays shut — § Known residuals.
- **An occluding emitter takes all three, and the criterion is its blend, not
  its depth.** Attachment 2 leaves the chain everything drawn in front of it
  composites against, so **any draw ordered after the volumetric emitters
  whose blend has a destination factor other than `One` has to dim attachment
  2 as well** — otherwise the resolve adds the band back on top of it. Depth
  cannot substitute: the emitters drew first, and the resolve adds attachment
  2 unconditionally. Additive and max blends need nothing, since neither can
  attenuate. Live members: the planet mesh, its ring annulus, its atmosphere
  shell — each writing `stellataOccluderTexel` at the alpha it composited
  attachment 0 with (`../emission/emission.glsl`).

**Two of these marks invert the gate's safety.** A draw that forgets
`markStatisticEmitter` merely fails to contribute; one that forgets
`markAbsorber` silently stops absorbing, which reads as a missing dark rift,
and one that forgets `markOccludingEmitter` silently stops occluding, which
reads as the Milky Way band glowing through a planet's night side. Both call
sites are pinned — `../../molecular-clouds/molecular-clouds.test.ts` and
`../../solar-system/planets/planet-mesh-layer.test.ts`.

Two further things the gate has to get right:

- **It is unbound whenever no MRT framebuffer is current.** `drawBuffers`
  on the default framebuffer accepts only `BACK` or `NONE`, so an emitter
  hook firing on the canvas path — chart mode, or a context with no
  float-renderable buffer — would be a GL error rather than a no-op.
- **The resting state is restored on the way out of every draw**, so a
  mid-frame re-bind of the target cannot leave the gate open behind it.

## The cache the gate rides

Every `drawBuffers` call above is issued **straight to the context**, behind
three's back. It survives only because three caches the draw buffers it
believes each framebuffer has (`WebGLState.drawBuffers`) and re-issues them
just on a change of **attachment count** or of **slot 0** — neither of which
any mark touches, since all four keep three attachments and all but
`markDiffuseEmitter` keep `COLOR_ATTACHMENT0` in slot 0. `markDiffuseEmitter`
puts `NONE` in slot 0, and three still won't re-issue, because it compares
against its own cached array rather than against the context.

That asymmetry is the whole mechanism: three's cache goes stale the moment a
mark fires, and staying stale is what keeps the gate shut until `bind()`
re-opens it. It is also why this is a **read of three's source, re-checked at
every version bump** rather than something a test can pin — `WebGLState` needs
a live context. `tests/three-version-audit.test.ts` is the tripwire that forces
the re-read.

`markStatisticEmitter` composes with whatever hooks the object already
carries, so it is order-independent against a layer that wants its own.

## One blend equation, every attachment

WebGL2 has no per-attachment blend state, so the blend an emitter chose for
its colour runs over its statistic and diffuse texels too. **Each emitter's
alpha on those attachments is therefore part of its contract, not a free
slot** — and it is what lets an occluder dim attachment 2 by a gate flag
rather than a second draw.

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
  attachments 0 and 2 but leaves the statistic reading the Milky Way band
  un-extincted. Inert: the band sits two decades under the adaptation
  anchor and cannot produce a cut on its own.
- **Authored chrome does not occlude the diffuse field.** Every
  alpha-composited chrome layer in front of the emitters — the galactic disc,
  both coordinate spheres, LG wireframes, the constellation figure, orbit and
  binary paths, probe markers, fresnel and cloud rim shells — blends into
  attachment 0 alone, so the band is added over it rather than under it, and
  line work crossing the band reads slightly brighter than it should. Several
  are built-in `Line` / `LineMaterial` programs with no fragment output to
  add, and `../README.md` § Chrome's inverse mapping is already exact only for
  a lone full-alpha fragment over black. Accepted: at the band's ceiling of
  38/255
  the shift is a fraction of a bright chrome line, and it applies to nothing
  photometric.
- **The crossfade band scales both channels alike.** A body's R and its
  mask both ride `uFade`, so `D` reads `uFade` × the truth for the one
  octave of body size the disc↔mesh crossfade spans — well under the ramp's
  foot, where the pin does not govern anyway.
- **A ring annulus extinguishes at face-on opacity.** A rasterised fragment
  carries no opening angle, so the slant-path term the source walk applied
  analytically — `T = (1 − α)^(1/|sin B|)`, opaque edge-on — is gone. It
  under-dims a source seen through a near-edge-on ring; edge-on is also
  where the zero-thickness annulus thins to a line and covers almost no
  texels, so the case it matters in is the case it barely arises in
  (`../../solar-system/planets/rings/README.md`).
