# HDR seam on WebGPU

The WebGPU half of the HDR seam (`../../hdr/README.md` owns the design:
unit, operator, attachments, pass ordering — nothing here re-decides
those). This folder carries the two mechanisms the port has to express
differently: the per-draw attachment gate, since a WGSL pipeline bakes
its attachment set and there is no `gl.drawBuffers` to flip; and the
statistic readback, since WebGPU has no pixel-pack buffer to fence on.
The shell holds either backend through `../../hdr/hdr-seam.ts`.

## Files in this area

```
src/client/webgpu/hdr/
  hdr-pipeline-webgpu.ts      WebGpuHdrPipeline — the lazy MRT target
    (+ test)                  (RGBA16F + RG16F + RGBA16F over a
                              requested Depth32Float reversed-z depth
                              attachment, § below),
                              bind/resolve, chart bypass, syncMode, the
                              dev switches, the resolve material, and
                              ownership of the gates and the reduction.
  emitter-gates.ts            The statistic write mask as a uniform node
                              (§ The gate becomes the output struct).
  mrt-material.ts (+ test)    finishMrtMaterial — the single-output ↔
                              three-member-struct swap every ported
                              emitter carries, and the two material flags
                              that would demote the struct.
                              finishMrtOutputMaterial is the same swap on
                              `outputNode` for a material whose own
                              fragment stage must survive (§ Composing
                              over three's fragment).
  summation-tsl.ts            TSL mirrors of stellata_summation and the
                              box downsample, over summation-pure's
                              constants.
  summation-pass-webgpu.ts    The downsample target + per-frame factor
    (+ test)                  choice — summation-pass.ts's contract, the
                              resolve's inputs handed over as nodes.
  reduction-webgpu.ts         WebGpuLuminanceReduction — the mip chain
    (+ test)                  (reduction-pure is the spec) with
                              readRenderTargetPixelsAsync replacing the
                              pixel-pack fence (§ Reduction).
```

## What the pipeline does NOT re-express

Three of the WebGL pipeline's mechanisms have no WebGPU counterpart, on
purpose:

- **No explicit clear in `bind()`** — the WebGL clear exists to open the
  drawBuffers gate for one call; WebGPU's render-pass clear writes every
  attachment regardless, so the statistic and diffuse attachments read
  zero (never stale) with no gate to hold open.
- **No `WebGLState.drawBuffers` cache ride** — the whole mechanism of
  `../../hdr/attachments/README.md` § The cache the gate rides is
  replaced by § The gate becomes the output struct below.
- **No float-support verdict** — `supported` is constant true; float
  render targets are core WebGPU. The inline-operator path survives for
  chart mode alone (`../../hdr/README.md` § Fallback).

## Reduction — the readback without the fence

The chain is the same halving mip pyramid stopped at the same tile level,
one NodeMaterial per level (source texture and sizes bake per level; the
whole set rebuilds on resize, which is when they change). What replaces
the pixel-pack buffer + fence is `renderer.readRenderTargetPixelsAsync` —
a mapAsync-staged copy whose promise resolves frames later, which is
exactly the frame-decoupled contract the render gate and the adaptation
park rely on. It reads the whole tile grid, and the CPU combine and the
coverage-weighted median that turn it into three numbers are
`reduction-pure`'s, shared with the WebGL2 half rather than re-expressed.
The one-in-flight rule, the stale-drop on a parked/disabled frame, and
the render-time-exposure pairing are all kept verbatim from
`../../hdr/exposure/reduction/README.md`; `fenceWhileParked` keeps its
name and behaviour for the frame-cost harness even though the ANGLE
submission-barrier rationale has no analogue here.

**The landing array is three's, so it is a fresh allocation per readback**
where the WebGL2 half refills one buffer it owns. At the tile level that
is ~23 KB every second-to-fourth frame rather than the 16 B the 1x1 tail
cost, so this backend alone carries a garbage-collection term the other
does not — the one place the two readbacks differ in cost rather than in
mechanism, and the thing to look at first if `stellata-8cg.29`'s re-take
splits by backend.

## The depth format is requested, not asserted

The target carries an explicit `FloatType` `DepthTexture` because
reversed-z only infers `Depth32Float` for the **canvas**; three
auto-creates `Depth24Plus` for a render target regardless, which voids
the local depth pass's K = 1 bracket by ~262 AU at Neptune's ring
(`../../local-depth/bracket/README.md` § Precision analysis). That
assignment is a **request**. Nothing here confirms it landed, and the
wording matters — an earlier version of this file said the format was
asserted, and the throw backing that claim tested four conditions the
same function had just written plus one the boot had already refused on.
It could not fire.

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

WebGL2's gate opens attachments per draw with `gl.drawBuffers`
(`../../hdr/attachments/README.md` § The gate). WebGPU bakes the
attachment set into the pipeline, so the same contract is expressed in
node-material terms instead, two mechanisms replacing the one call:

- **Which attachments a draw writes is its fragment `outputStruct`** —
  positional members land on attachments 0/1/2. A slot the WebGL gate
  would mask off instead writes **the blend's identity element**: under
  the material's own blend (one blend state covers every attachment,
  same as WebGL2) a zero write is `dst + 0` for additive, `max(dst, 0)`
  for per-channel max over non-negative values, and `0·1 + dst·(1−0)`
  for premultiplied-over — the destination is untouched in every case,
  which is exactly what `NONE` bought. The struct member and the mark
  are one decision here too: a material with no struct cannot reach the
  extra attachments at all, so chrome stays safe by default.
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
are rare (mode changes, not frames), so the pipeline rebuild is paid
where the WebGL build re-linked programs anyway.

### Composing over three's fragment

`fragmentNode` *replaces* the fragment stage, which is right for every
emitter authoring its own shading and wrong for a material whose shading
is three's — a fat line's segment coverage. `finishMrtOutputMaterial`
installs the same pair of graphs on `material.outputNode` instead: three
runs its built-in shading, assigns the result to the `output` property,
and only then lets `outputNode` decide what leaves the stage. The struct
is therefore composed **over** `output` rather than in place of it, and
`builder.stack.outputNode` still carries the `OutputStructNode` at the top
level, which is what both backends test to emit a struct at all.

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
absorption pipelines shipped that way at `0it.6` and extincted nothing on a
WebGPU boot.

So `finishMrtMaterial` guards both, differently on purpose:

- **`fog` is forced off**, not asserted. It defaults to **true** on every
  `NodeMaterial` and is inert only while no scene carries a fog node, so an
  assertion would fire on every ported material and a scene fog would break
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
