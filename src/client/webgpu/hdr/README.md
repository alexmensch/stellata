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
                              Depth32Float reversed-z depth attachment),
                              bind/resolve, chart bypass, syncMode, the
                              dev switches, the resolve material, and
                              ownership of the gates and the reduction.
  emitter-gates.ts            The statistic write mask as a uniform node
                              (§ The gate becomes the output struct).
  mrt-material.ts             finishMrtMaterial — the single-output ↔
                              three-member-struct swap every ported
                              emitter carries.
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

The chain is the same halving mip pyramid, one NodeMaterial per level
(source texture and sizes bake per level; the whole set rebuilds on
resize, which is when they change). What replaces the pixel-pack buffer
+ fence is `renderer.readRenderTargetPixelsAsync` — a mapAsync-staged
copy whose promise resolves frames later, which is exactly the
frame-decoupled contract the render gate and the adaptation park rely
on. The one-in-flight rule, the stale-drop on a parked/disabled frame,
and the render-time-exposure pairing are all kept verbatim from
`../../hdr/exposure/reduction/README.md`; `fenceWhileParked` keeps its
name and behaviour for the frame-cost harness even though the ANGLE
submission-barrier rationale has no analogue here.

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
