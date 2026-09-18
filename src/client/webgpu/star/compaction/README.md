# Star compaction

One compute pass per rendered frame lists the stars each pass will draw,
so the three star draws are priced at **survivor count**: each
`drawIndexedIndirect` takes its instance count from a buffer the kernel
counted into, and the vertex stage resolves `instance_index` through the
list to its catalogue star. `docs/render-rules.md` § 1 is the rule this
discharges; the vertex stage that runs over the survivors, and the
tables it reads, are `../README.md`.

## Files in this area

```
src/client/webgpu/star/compaction/
  compaction-pure.ts (+ test)   The layout: two tiers, where each list
                                starts in the shared survivor buffer, and
                                each tier's five-u32 indirect-args slot.
  star-compaction.ts (+ test)   StarCompaction — the survivor and args
                                buffers, the reset + compaction kernels,
                                the per-frame dispatch, the on-demand
                                count readback, dispose.
  frustum-tsl.ts                The frustum test as TSL over a clip-space
                                centre and an NDC half-extent, shared with
                                the extinction cache's refill
                                (../../extinction/refill/README.md § Only
                                what is in frame); `starQuadOffscreen` is
                                its CPU mirror.
```

## Two lists, one kernel, three draws

The kernel runs one thread per catalogue star. A survivor's index is
appended to the list for its **tier** — glow (`physRatio` under
`PHYS_RATIO_THRESHOLD`) or disc — with an `atomicAdd` on that tier's
`instanceCount` inside the args buffer; the slot it returns is where the
index lands. Both lists live in one `uint` buffer of `2 × count` slots,
glow first (`tierListBase`), so a pass's vertex stage reads
`survivors[listBase + instance_index]`.

The draws stay three, exactly the WebGL2 count. The core mask and the
disc draw both consume the disc list — one geometry, one args slot,
`indirectOffset` 20 — and the glow draw its own at offset 0. Mask-only
and disc-only differences (a member keeps its stamp, a
composite-suppressed star loses its disc) are per-instance collapses
the vertex stage still applies over the shared list, as it always did.

**Routing is the vertex stage's own arithmetic.** The kernel calls
`solveStarTsl` (`../star-vertex-tsl.ts`), the same TSL graph all six
star vertex stages run, so the tier it assigns is bit-identical to the
`vPhysRatio` the drawing pass's fragment partitions on. A kernel that
tiered a star differently from its pass would drop it from both lists'
fragment partitions and draw it nowhere — which is why the solve is one
function and not a mirror.

**Conservative where it must be.** The kernel evaluates the glow pass's
bound (the widest: its taper margin) with no eclipse dim folded and no
suppression applied. So a star any pass would collapse — the hidden focal
star, a local-pass member, a composite-suppressed disc, an eclipse at
totality, a dim carrying a glow under the taper — is still listed, and
that pass's vertex stage collapses it to the clip sentinel exactly as
before. The lists are supersets of what draws by at most those few
instances; the tiering is exact. Under the extinction A/B toggle the
kernel marches the dust volume like the vertex fallback does, so a star's
tier does not move with the toggle.

Chart mode routes every survivor to the disc list (`physRatio` stays 1
there), so the glow draw issues zero instances on paper.

## The frustum test

A survivor is listed only if its quad can touch the viewport. The kernel
projects the star's local position through a view-projection uniform the
dispatch composes from the camera each frame (`projectionMatrix ×
matrixWorldInverse`, the star meshes sitting at the identity — the vertex
stage draws through `projectionMatrix × modelViewMatrix`, so a transform on
any of the three would cull what still draws, and `star-layer.test.ts` pins
them), and drops
the star when it is behind the camera (clip w ≤ 0) or its centre lies
outside the clip box by more than the quad's own half-extent —
`pxSize / uViewport` in NDC, the vertex stage's corner offset at
corner ±0.5 — plus `CULL_SLACK_NDC`, a sub-pixel allowance for the two
stages forming the clip position in a different float32 order.
`starQuadOffscreen` (`compaction-pure.ts`) is the CPU mirror and carries
the tests. Three.js frustum culling is off on every layer because
floating-origin rebasing invalidates its bounding spheres
(`docs/render-rules.md` § 1), so this is the star population's only
frustum test, and it is exact: a quad off the screen covers no pixel
whatever else is true of the star.

One exemption. The pinned focal star (`uPinFocusToCenter`) projects
through a substituted matrix in the vertex stage, so its true projection
says nothing about where it draws — it is always listed. Local-pass
members need none: a member's main-pass draws collapse anyway, and the
core mask's stamp for an off-screen member covers no pixel.

The list sizes now move with the camera's orientation and field of view,
not only with the magnitude window; nothing reads a list's size on the
CPU, so no consumer sees the difference.

## The frame order

`StarLayer.update(camera)` runs the compaction, and the shell calls it
after `syncUniformNodes()` and before `renderer.render()`: the kernel
reads the scalars that sync just copied (`uThresholdMag`, `uCullMag`, the
filter band, the clock) and the render reads the lists it wrote. The
dispatch refreshes the camera's world matrices itself: the controls
mutate position and quaternion without propagating them, and the render
that would is still ahead, so a kernel reading them as left by the last
render would cull against the previous frame's view. Inside `update()`
the layer first forwards this frame's attribute writes onto the tables
(`../README.md` § Star tables), so the kernel and the draws see the same
positions — a kernel listing survivors off last frame's positions on a
recentre frame would flicker the whole field.

The reset kernel (one thread, both `instanceCount`s to zero) and the
compaction kernel are one `renderer.compute([...])`: one compute pass,
one submit, and WebGPU orders dispatches within a pass so the atomics
see the reset. Every rendered frame pays that submit; the render gate
already decides whether a frame renders at all.

## Reading the counts back

`debug.survivors()` maps a copy of the args buffer and prints each tier's
`instanceCount` beside the catalogue record count
(`../../../debug/survivor-counts.ts`). That ratio is what sizes every
elision decision on the star path — "how much of the catalogue is actually
in frame here" is otherwise unanswerable, since the counts exist only on
the GPU and no draw ever reads them on the CPU.

**A third counter, `PREFILTER_COUNT_ELEMENT`, sits one u32 past the two
draw slots**: every star the dust-independent prefilter admits, counted
before the frustum test, one atomic per admitted star per frame. No draw
reads it. `drawn / prefilter` is the share the frustum alone keeps of a
population a prefilter-gated kernel already runs over — the extinction
cache's gate is that kernel (`../../extinction/README.md` § The cache
gate), so this ratio, not `drawn / records`, is the frustum's prize
there.

**On demand, never per frame.** The readback resolves frames later, so a
per-frame one would either stall the render path or report a stale frame's
number as the current one; neither buys anything a console call at a
parked camera does not. It reads the *last dispatch's* counts, so take it
with the camera settled.

`survivorCountsFromArgs` (`compaction-pure.ts`) takes the very slots the
three draws take their instance count from — the same
`tierArgsInstanceCountElement` — so a layout change cannot move one
without moving the other, and the test pins both.

## The buffer-writer requirements, discharged

Of the four the single-writer audit put on this design (bead
`stellata-0it.15`, design field; `docs/render-rules.md` § 7):

- **Per-draw addressing (1)** — met with no slots. The survivor buffer
  and the args buffer are each written once per frame, by one dispatch,
  in the compute submit ahead of the render submit; every draw that
  reads them in that render wants the same bytes (mask and disc share the
  disc slot, glow has its own). The mirror draws read neither: their
  survivor set is the CPU member list they already draw at member count
  (`../README.md` § The local mirror). No per-draw write exists, so
  `writeBuffer` ordering has nothing to race.
- **The running-total router (2)** — not built, by decision. No draw
  spans more than one compacted group: each of the three draws reads
  exactly one list. The prefix sum is owed the day one draw has to span
  several variable-size groups (LOD tiers under `stellata-cns.1.1`).
- **The implicit draw count (3)** — the args the kernel counted into are
  the draw's instance count; no CPU readback sizes any draw.
  `geometry.instanceCount` stays a nominal count only because three skips
  a geometry whose nominal count is 0 before it reaches the indirect draw.
  The bead spelled this requirement as binding the survivor buffer *at its
  compacted length*; the buffer binds at its full `2 × count` instead,
  since that length only exists on the GPU. Binding short was the means,
  not the requirement — what it was there to buy is the absent readback,
  and the indirect args buy that outright.
- **The uploader trap (4)** — `../README.md` § Star tables: no
  itemSize-3 storage attribute exists anywhere in this layer.

## Binding budget

A main-pass star vertex stage binds `STAR_VERTEX_STAGE_STORAGE_BUFFERS`
(7) storage buffers: the survivor list, the A_V cache, the static table
and the four forwarded tables. The mirror's binds 6 (no list). The kernel
binds 6: position, statics, suppress-pulsation, A_V, survivors, args.
Core WebGPU guarantees 8 per stage; the compatibility level reports 0 in
the vertex stage and the boot refuses it against that constant
(`../../tsl/README.md` § Storage attributes). A new per-star table costs a
binding in every one of those stages.

## What it costs, and what it holds

Byte counts, derived not measured — `recordCount`
(`scripts/catalog/build-catalog-expected.json`) × element size:

| Resident | Size |
| --- | --- |
| Survivor lists (2 × count × u32) | 388,071 × 8 B ≈ 2.96 MiB |
| Indirect args (2 slots × 5 × u32) | 40 B |

Per rendered frame: one compute submit, 388,071 threads each running the
solve to the routing point (magnitude, pulsation, prefilter, one A_V read
or the fallback march, the size solve), one projection, and two atomics
per survivor. What it removes is the vertex-stage floor: each of the
three passes ran its stage over 4 corners × the whole catalogue with the
invisible members exiting to the clip sentinel; now each runs over
4 corners × the survivors inside the view. The frame-time delta is the
Tier 2 pin's to state (`RELEASING.md` § Perf pin), not this file's.
