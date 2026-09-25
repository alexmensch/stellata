# HDR pipeline

The implementation behind the HDR seam (`../../hdr/README.md` owns the
design: unit, operator, attachments, pass ordering — nothing here
re-decides those). This folder carries the two mechanisms that design
leaves to the renderer: which attachments a draw writes, since a WGSL
pipeline bakes its attachment set; and the statistic readback, which is
asynchronous. The shell holds it through `../../hdr/hdr-seam.ts`.

## Files in this area

```
src/client/webgpu/hdr/
  hdr-pipeline-webgpu.ts      WebGpuHdrPipeline — the lazy MRT target
    (+ test)                  (RGBA16F + RG16F + RGBA16F over a
                              requested Depth32Float reversed-z depth
                              attachment, README.md#the-depth-format-is-requested-not-asserted),
                              bind/resolve, chart bypass, syncMode, the
                              dev switches, the resolve material, and
                              ownership of the gates and the reduction.
  emitter-gates.ts            The statistic write mask as a uniform node
                              (README.md#the-gate-becomes-the-output-struct).
  mrt-material.ts (+ test)    finishMrtMaterial — the single-output ↔
                              three-member-struct swap every
                              emitter carries, and the two material flags
                              that would demote the struct.
                              finishMrtOutputMaterial is the same swap on
                              `outputNode` for a material whose own
                              fragment stage must survive (README.md#composing-over-threes-fragment).
  summation-tsl.ts            The summation convolution and the box
                              downsample, over summation-pure's
                              constants.
  summation-pass-webgpu.ts    The downsample target + per-frame factor
    (+ test)                  choice, the resolve's inputs handed over as
                              nodes.
  reduction-webgpu.ts         WebGpuLuminanceReduction — the mip chain
    (+ test)                  (reduction-pure is the spec) and its
                              readRenderTargetPixelsAsync readback
                              (README.md#reduction--an-asynchronous-readback).
```

## Reduction — an asynchronous readback

The chain is the halving mip pyramid stopped at the tile level, one
NodeMaterial per level (source texture and sizes bake per level; the
whole set rebuilds on resize, which is when they change). The readback is
`renderer.readRenderTargetPixelsAsync` — a mapAsync-staged copy whose
promise resolves frames later, which is exactly the frame-decoupled contract the render gate and the adaptation
park rely on. It reads the whole tile grid, and the CPU combine and the
coverage-weighted median that turn it into three numbers are
`reduction-pure`'s, imported rather than re-expressed.
The one-in-flight rule, the pinnable cadence, the stale-drop on a
parked/disabled frame, and the render-time-exposure pairing are
`../../hdr/exposure/reduction/README.md`'s; `fenceWhileParked` keeps the
readback issuing across a park, which the frame-cost harness's request
accounting relies on.

**The landing array is three's, so it is a fresh allocation per readback**
rather than refilling one buffer it owns: ~23 KB at the tile level every
second-to-fourth frame, a garbage-collection term to look at first if a
dwell shows readback-frame jank.

## The depth format is requested, not asserted

The target carries an explicit `FloatType` `DepthTexture` because
reversed-z only infers `Depth32Float` for the **canvas**; three
auto-creates `Depth24Plus` for a render target regardless, which voids
the local depth pass's K = 1 bracket by ~262 AU at Neptune's ring
([Precision analysis](../../local-depth/bracket/README.md#precision-analysis)). That
assignment is a **request**. Nothing here confirms it landed; a throw
testing the fields this same function writes could never fire.

**A real check is possible and deliberately not taken.** Three allocates
a render target's GPU textures lazily, at first use, so the allocated
format only becomes readable — as
`renderer.backend.get(rt.depthTexture).texture.format` — *after* the
first render into the target. That is one internal read of exactly the
kind `0it.24`'s preference order argued against, and it lands past the
only point a fallback exists: `bootWebGpu` returns the seam before any
frame, so a refusal there could be a throw or a latched warning in an
already-broken app, never a fallback. What defends the bracket instead is
the pin in `hdr-pipeline-webgpu.test.ts` on the four target fields —
because the failure that can actually happen is an edit dropping the
explicit depth texture, not a backend quietly substituting a format.

The `0it.26` three bump revisits the subject: if three starts defaulting
the depth type under `reversedDepthBuffer`, the request itself becomes
redundant.

## The gate becomes the output struct

The contract is [The gate](../../hdr/attachments/README.md#the-gate--chrome-is-safe-by-default). WebGPU
bakes the attachment set into the pipeline, so it is expressed in
node-material terms, by two mechanisms:

- **Which attachments a draw writes is its fragment `outputStruct`** —
  positional members land on attachments 0/1/2. A slot the draw must not
  reach writes **the blend's identity element**: under
  the material's own blend (one blend state covers every attachment,
  a zero write is `dst + 0` for additive, `max(dst, 0)`
  for per-channel max over non-negative values, and `0·1 + dst·(1−0)`
  for premultiplied-over — the destination is untouched in every case. The
  struct is the whole declaration: a material with no struct cannot reach
  the extra attachments at all, so chrome stays safe by default.
- **The per-frame masks ride a uniform, not a pipeline swap.** The
  statistic park flips every rendered frame, and rebuilding pipelines at
  that cadence would be the most expensive gate available — so
  `emitter-gates.ts`'s `statisticWrites` node scales the statistic texel
  to the identity element instead (`maskedStatisticTexelTsl`). Valid
  because every statistic writer's blend has an identity at zero (the
  table above); the clear needs no mask — the render-pass clear writes
  every attachment regardless, so the attachment reads zero, never stale.

  **It has to scale the WHOLE texel, alpha included.** Masking the flux
  and the coverage bit alone is identity only for an additive writer; the
  planet mesh, its ring annulus and its atmosphere shell composite, so a
  `(0, 0, 0, alpha)` write would keep dimming the attachment by
  `1 − alpha` while claiming to be masked off.

**The struct's member count must match the bound target's attachment
count.** A WGSL fragment output with no colour target behind it fails
pipeline creation, so the star materials swap between their
single-output fragment and the three-member struct exactly when the
target mode flips (`StarLayer.setMrtOutputs`) — chart mode and the
single-attachment frame-cost lever both ride the same swap. The flips
are rare (mode changes, not frames), so the pipeline rebuild is paid only
on a mode change.

**Every material drawn into the target takes the swap, the depth-only
core mask included — for three's pipeline cache, not for validity.** A
lone `@location(0)` output under a three-target pipeline IS valid when
`colorWrite` is off (the write mask is zero on every target). But three
builds a pipeline's colour-target list from the bound target's texture
count while keying its render-pipeline cache on the two program ids plus
attachment 0's format alone (`WebGPUBackend.getRenderCacheKey`, r185).
Attachment 0 is RGBA16F in both target modes, so a material whose fragment
program is identical in both was handed the cached three-target pipeline
inside the one-target pass: `Attachment state of [RenderPipeline
"renderPipeline_star-core-mask-tsl"] is not compatible with
[RenderPassEncoder]`, and Dawn dropped every command buffer carrying it —
the whole star pass, 600 validation errors per frame-cost sweep at Sol and
Earth. Swapping the mask's fragment graph changes its program id, which is
what makes the cache miss. A new depth-only or colour-masked material on
this target owes the same swap.

### Composing over three's fragment

`fragmentNode` *replaces* the fragment stage, which is right for every
emitter authoring its own shading and wrong for a material whose shading
is three's — a fat line's segment coverage. `finishMrtOutputMaterial`
installs the same pair of graphs on `material.outputNode` instead: three
runs its built-in shading, assigns the result to the `output` property,
and only then lets `outputNode` decide what leaves the stage. The struct
is therefore composed **over** `output` rather than in place of it, and
`builder.stack.outputNode` still carries the `OutputStructNode` at the top
level, which is what three's WGSL builder tests to emit a struct at all.

### Two material flags silently demote the struct

`premultipliedAlpha` and `fog` both make `NodeMaterial.setupOutput` **wrap**
the fragment output node — `premultiplyAlpha(outputNode)` and a fog mix
respectively. `buildCode` then tests `isOutputStructNode` on the *top-level*
node, which the wrapper is not, so three declares a one-attachment
`OutputStruct { color }` while the `OutputStructNode` underneath still emits
its own `output.m0/m1/m2 = …` lines. The result is a WGSL parse error
reading `struct member m0 not found`, an invalid pipeline, and a layer that
**still draws and still sorts** while writing nothing — it names neither
blending nor fog, which is what makes it expensive to find. Both cloud
absorption pipelines once shipped that way and extincted nothing.

So `finishMrtMaterial` guards both, differently on purpose:

- **`fog` is forced off**, not asserted. It defaults to **true** on every
  `NodeMaterial` and is inert only while no scene carries a fog node, so an
  assertion would fire on every emitter material and a scene fog would break
  all of them at once.
- **`premultipliedAlpha` throws, and only on the way INTO struct mode.**
  Chart mode legitimately sets it on the star materials, because three
  refuses `MultiplyBlending` without it (`../../chart-mode/README.md`), and
  that is safe precisely because chart unbinds the target — those materials
  are on their single-output graph while the flag holds. The illegal state is
  the flag *and* the struct, not the flag. It also pins an ordering the shell
  already relies on: every layer's own chart swap runs before
  `HdrPipeline.setChartMode` reaches `syncMode`.

A material wanting premultiplied blending under the struct spells the
factors out instead — `CustomBlending` with `OneFactor` /
`OneMinusSrcAlphaFactor`, which is what the flag would have selected.
Flipping the flag to `false` under `NormalBlending` is **not** the same
thing: the colour result matches wherever `src.rgb` is 0, but the alpha
channel becomes `a² + dst·(1−a)` instead of `a + dst·(1−a)`, and
attachment 2's alpha is what the resolve composites against.
