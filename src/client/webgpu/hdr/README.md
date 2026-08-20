# HDR seam on WebGPU

The WebGPU half of the HDR seam (`../../hdr/README.md` owns the design:
unit, operator, attachments, pass ordering). This folder carries what
the port has to express differently — starting with the per-draw
attachment gate, which WGSL pipelines cannot drive through
`gl.drawBuffers`.

## Files in this area

```
src/client/webgpu/hdr/
  emitter-gates.ts    The statistic write mask as a uniform node
                      (§ The gate becomes the output struct).
```

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
  `emitter-gates.ts`'s `statisticWrites` node multiplies the statistic
  texel's flux and mask to the identity element instead. Valid because
  every statistic writer's blend has an identity at zero (the table
  above); the clear needs no mask — the render-pass clear writes every
  attachment regardless, so the attachment reads zero, never stale.

**The struct's member count must match the bound target's attachment
count.** A WGSL fragment output with no colour target behind it fails
pipeline creation, so the star materials swap between their
single-output fragment and the three-member struct exactly when the
target mode flips (`StarLayer.setMrtOutputs`) — chart mode and the
single-attachment frame-cost lever both ride the same swap. The flips
are rare (mode changes, not frames), so the pipeline rebuild is paid
where the WebGL build re-linked programs anyway.
