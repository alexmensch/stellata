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
                                centre and an NDC half-extent, run twice by
                                the kernel — at the quad's extent for the
                                survivor list, at the extinction slack for
                                the refill worklist
                                (../../extinction/refill/README.md § Only
                                what is in frame); `starQuadOffscreen` is
                                its CPU mirror.
```

The kernel also appends the extinction refill's worklist; that block, its
population and its schedule are `../../extinction/refill/README.md` § The
compaction appends the worklist, and this file carries only what it costs
the compaction (§ The refill dispatch, § Binding budget).

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

The reset kernel (`REFILL_BUCKETS` threads: thread 0 zeroes both
`instanceCount`s and the prefilter counter, and on an armed frame every
thread zeroes its bucket's refill counter),
the compaction kernel and — on an armed frame — the two scan kernels
(§ The refill dispatch) are
one `renderer.compute([...])`: one compute pass, one submit, and WebGPU
orders dispatches within a pass so the atomics see the reset, the scan sees
the atomics, and its second half sees the copy its first half made. Every rendered frame pays that submit; the render gate
already decides whether a frame renders at all. The extinction prepass
dispatches *before* this pass in the frame and reads the worklist this
pass wrote the frame before (`../../extinction/refill/README.md` § The
cursor).

## Reading the counts back

`debug.survivors()` maps a copy of the args buffer and prints each tier's
`instanceCount` beside the catalogue record count
(`../../../debug/survivor-counts.ts`). That ratio is what sizes every
elision decision on the star path — "how much of the catalogue is actually
in frame here" is otherwise unanswerable, since the counts exist only on
the GPU and no draw ever reads them on the CPU.

**A third counter, `PREFILTER_COUNT_ELEMENT`, sits one u32 past the two
draw slots**: every star the dust-independent prefilter admits, counted
before the frustum test. No draw reads it. `drawn / prefilter` is the share
the frustum alone keeps of a population a prefilter-gated kernel already
runs over — the extinction cache's gate is that kernel
(`../../extinction/README.md` § The cache gate), so this ratio, not
`drawn / records`, is the frustum's prize there.

**It is armed by the readback and by nothing else**, because it would
otherwise be an `atomicAdd` on a single address from every admitted thread
— near 116k of them at `mw120`, some five times the two tier atomics
combined — on every rendered frame, for a number no draw consults. A
`uCountPrefilter` uniform gates it; `readSurvivorCounts` raises it, waits
for one dispatch to count into and lowers it again. So the count belongs to
a frame that exists *because* something asked for it, and every other frame
pays one uniform compare.

**On demand, never per frame.** The readback resolves frames later, so a
per-frame one would either stall the render path or report a stale frame's
number as the current one; neither buys anything a console call at a
parked camera does not.

**The caller owes it a rendered frame.** A settled camera has parked the
render gate, and an armed read waits on a dispatch that will never come, so
`Stellata.readSurvivorCounts` invalidates the gate before awaiting. Dispose
releases a waiter rather than leaving it pending for the boot's life. Take
the number with the camera settled all the same: the one frame the
invalidation buys draws the settled view.

`survivorCountsFromArgs` (`compaction-pure.ts`) takes the very slots the
three draws take their instance count from — the same
`tierArgsInstanceCountElement` — so a layout change cannot move one
without moving the other, and the test pins both.

## The refill dispatch

On an armed frame the threads of one residue class — `quarter`, a shared
uniform — append every star of that class the extinction refill has to
march to the star's **Morton bucket**, counting with an `atomicAdd` on that
bucket's counter: `REFILL_BUCKETS` u32 past the prefilter counter in the
args buffer (`REFILL_LIST_COUNT_BASE`), so the counters cost no binding.
Every kernel addresses one through the same expression,
`RefillWorklistNodes.counterElement`. `arm` is a uniform the prepass holds
up for `REFILL_SLICES` frames from a request, and the reset kernel — now
`REFILL_BUCKETS` threads wide, its thread 0 still doing the tiers and the
prefilter — zeroes the counters under that same arm. The bucket partition
and what the list order buys are
`../../extinction/refill/README.md` § Bucketed by Morton range.

**Two kernels close the pass, because the scan must not read the atomics
`REFILL_BUCKETS` times each.** The first copies every bucket's counter out
of the args buffer into `refillDispatch`, one thread per bucket, through
the same atomic view the kernel added into. The second has thread *b* sum
the copies before it — plain reads out of a 1 KiB table, so the
`O(REFILL_BUCKETS²)` of a per-thread scan stays in L1 — and write the
exclusive prefix the refill kernel searches; its last thread also writes
`[⌈n / REFILL_WORKGROUP_SIZE⌉, 1, 1, n]`, the three u32
`dispatchWorkgroupsIndirect` reads and the listed length the refill kernel
bounds its threads by. The prefix and the copies occupy disjoint ranges of
`refillDispatch` (`REFILL_PREFIX_BASE`, `REFILL_BUCKET_COUNT_BASE`), so no
thread reads a word another is writing. The extinction prepass dispatches
at that count and reads both tables through `refillDispatchNode`, a
read-only node of its own over the same attribute, so no count ever crosses
to the CPU. The divisor is the workgroup size the refill kernel is built
with, one constant for both.

**Two storage nodes over that one attribute, never one narrowed.**
`toReadOnly()` narrows the node it is called on rather than returning a view,
so a single node narrowed for the refill kernel is read-only in the finish
kernel too and that kernel's pipeline then fails to compile on the device —
which discards the whole submit, and with it every star this pass lists.
`storageWriteRead` builds the pair (`../../tsl/README.md` § Storage
attributes).

**Both scan kernels are dispatched on armed frames only, and `dispatch()`
picks the kernel list by `refill.arm` rather than branching inside them.**
What they write is read only by the refill kernel, which the prepass
dispatches only on the frame after a class was built — and a class is built
only under the arm. So a parked camera would otherwise pay
`O(REFILL_BUCKETS²)` L1 reads every frame to republish a prefix nothing
reads: measured at 0.028 ms per frame at 1,278,785 records, against a win
that only lands while the camera moves. The arm is set by the prepass,
which runs earlier in the frame (§ The frame order), so the CPU knows it
before this pass is submitted and the two dispatches cost nothing at all on
a settled frame.

**The scan's copy kernel is the only reader of an atomic outside the
compaction kernel, and it reads each counter once.** A refill thread
reading a counter directly is the shape § Reading the counts back refuses
for `PREFILTER_COUNT_ELEMENT`: an atomic read-modify-write on one address
from every thread of the dispatch. The counts already exist at the end of
the pass, so republishing them as plain `u32` beside the dispatch costs one
read each and buys a scan and a search that touch no atomic at all.

## The kernel's thread count follows the decoded records

`setLoadedCount` assigns `ComputeNode.count` on the per-star kernel alone.
Three treats that as a mutable field feeding both the dispatch size and an
`instanceIndex >= count` guard delivered as a **uniform**, so a progressive
catalog load moves it per landing chunk with no pipeline recompile and no
bind-group rebuild (`../../../loaders/README.md` § Progressive catalog load).

It is a correctness bound before it is a saving. An undecoded record is
all-zero — position (0,0,0), which is Sol, and `absmag` 0 — so it passes the
prefilter and the frustum test and lands in the disc list as a phantom bright
star at the origin. The static table's padding does not prevent that; only
the bound does.

**`tierListBase` keeps using the FULL count.** The second tier's base is an
address in the survivor buffer, not a function of how many threads ran, and
the buffer stays allocated at `2 × count`.

**Never use `Renderer.compute`'s per-call `dispatchSize` for this.** It
applies the override to every node in the array, which would blow the
one-thread reset and finish kernels up to the record count. The extinction
prepass may pass it only because it dispatches a single node.

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
and the four forwarded tables. The mirror's binds 6 (no list). **The
kernel binds `STAR_COMPACTION_KERNEL_STORAGE_BUFFERS` (8)** — position,
statics, suppress-pulsation, A_V, survivors, args, and the refill's stamps
and worklist — which is the whole core guarantee of 8 per stage
(`WEBGPU_CORE_STORAGE_BUFFERS_PER_STAGE`); a ninth needs a counter folded
into the args buffer or a table folded into another, never a new binding —
both of which this pass has now spent, the refill's bucket counters on the
first and its `slotOf` read on the second
(`../../extinction/refill/README.md` § The compaction appends the
worklist). Each scan kernel binds 2, args and the refill dispatch. The
compatibility level reports 0 in the vertex stage and the boot refuses it
against that constant (`../../tsl/README.md` § Storage attributes). A new
per-star table costs a binding in every one of those stages.

## What it costs, and what it holds

Byte counts, derived not measured — `recordCount`
(`scripts/catalog/build-catalog-expected.json`) × element size:

| Resident | Size |
| --- | --- |
| Survivor lists (2 × count × u32) | 388,071 × 8 B ≈ 2.96 MiB |
| Indirect args (2 slots × 5 × u32 + prefilter counter + `REFILL_BUCKETS` refill counters) | 1,068 B |
| Refill dispatch (4 × u32 + two `REFILL_BUCKETS` scan tables) | 2,064 B |

The refill's stamps and worklist are the prepass's
(`../../extinction/README.md` § What it costs, and what it holds).

Per rendered frame: one compute submit, 388,071 threads each running the
solve to the routing point (magnitude, pulsation, prefilter, one A_V read
or the fallback march, the size solve), one projection, and two atomics
per survivor; on an armed frame, the refill producer on a quarter of the
threads as well — the frustum at the refill's slack, the four gate terms,
a stamp read for the in-frame admitted, and a slot read plus one atomic per
stale star of the class — plus the two `REFILL_BUCKETS`-wide scan
dispatches, which an unarmed frame does not issue. What it removes is the vertex-stage floor: each of the
three passes ran its stage over 4 corners × the whole catalogue with the
invisible members exiting to the clip sentinel; now each runs over
4 corners × the survivors inside the view. The frame-time delta is the
Tier 2 pin's to state (`RELEASING.md` § Perf pin), not this file's.
