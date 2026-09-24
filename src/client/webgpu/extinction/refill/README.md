# Refilling the extinction cache off a worklist

Which stars the A_V cache refills on a given frame. The march and the
cache gate are the parent's (`../README.md`); this folder owns the
population and the schedule: the compaction kernel appends the stars a
frame has to refill to a worklist, and the prepass marches one quarter of
it per frame.

```
src/client/webgpu/extinction/refill/
  refill-slices-pure.ts       REFILL_SLICES, the residue partition
    (+ test)                  (refillQuarterOf), and the cursor —
                              planRefill over the quarters still owed.
  refill-buckets-pure.ts      REFILL_BUCKETS, the Morton-range partition a
    (+ test)                  star is appended under (refillBucketCapacity,
                              refillBucketOf, refillWorklistLength), and the
                              scan and search the kernels mirror.
  refill-decision-pure.ts     The per-star verdict as CPU arithmetic
    (+ test)                  (slotRefills), the slack, the view a turn is
                              detected against (composeViewProjectionAbs,
                              sameView), and the CPU count of what that
                              view admits (countInFrameAbs). The rotation
                              case is pinned here.
  refill-worklist-nodes.ts    The shared slots: stamps and the fused
                              slot/worklist table over placeholders, the
                              arm / generation / quarter uniforms both
                              kernels read, counterElement — a bucket's
                              counter in the args buffer — and the three
                              accessors that address the fused table
                              (slotOf, bucketOf, worklistElement).
  refill-worklist-tsl.ts      The producer block the compaction kernel
                              runs — frustum, gate, stamp, append.
```

## Only what is in frame

A_V is read for the stars the compaction lists — the ones whose quad can
touch the viewport — and for nothing else, so a refill of everything the
prefilter admits marches, at the `mw120` canon vantage, some five times
the stars any draw will consult. The frustum test therefore sits ahead of
the refill, and the kernel that runs it is the **compaction's**, which
already holds every star's position:

1. `viewProjection × vec4(localPos, 1)` — the compaction's own matrix over
   the floating-origin local position, the same clip its survivor test
   takes. No second matrix and no second camera: producer and survivor
   list are one dispatch.
2. `starQuadOffscreenTsl` (`../../star/compaction/frustum-tsl.ts`) with a
   fixed half-extent of `EXTINCTION_FRUSTUM_SLACK_PX` in place of the
   quad's size, which is not known ahead of the solve — it needs the size,
   which needs the A_V being computed. The pinned focal star counts as seen
   whatever its projection, as it does in the compaction.
3. Out of frame → nothing, and the star's A_V and stamp stay as they were.
   In frame → the cache gate, then the **generation stamp** below.

**The slack's failure mode is a stale A_V, never a missing star.** The
compaction still lists a star whose quad overlaps the screen edge by more
than the slack, and the vertex stage draws it with its last A_V. That is a
resolved disc hundreds of px wide with its centre well past the edge — a
close-approach case, where the camera's AU-scale motion moves A_V by
nothing. State the vantage before narrowing the slack.

**The prepass still composes the absolute view each frame** —
projection × view × T(−worldOffset) in float64 from the camera the shell
hands `update()` — to *detect* a turn (`sameView`), since a turn is a
request ([A view change is a refill request](#a-view-change-is-a-refill-request--nothing-more)), and for `countInFrame()`.
The shell runs the prepass after the ride fan-out and the compaction after
that (`../../../stellata.ts` `animate`): the request the prepass raises
from this frame's camera is what the compaction answers in this frame.

### Counting the in-frame population

`countInFrame()` runs the frustum test above over `catalog.positions` on
the CPU at the view the prepass last saw, and returns how many stars it
admits — the population the producer runs the cache gate over on an armed
frame. `debug.survivors()` prints it beside the compaction's counters and
`pnpm run survivors` records it ([Survivor counts](../../../debug/README.md#survivor-counts)),
so that population is readable at a vantage without a clock.

**Only the matrix is the last view's.** `uViewport` and
`uPinFocusToCenter` are read live. A viewport change moves the projection
and so is a new view, but setting the focal pin bumps nothing — a count
taken after a focus change carries the new pin against the old matrix, one
star either way. Take it at a settled camera, as `debug.survivors()`
already asks.

**`in frame − drawn` bounds the gate-rejected population from above; it is
not that population.** `drawn` is the compaction's survivor count, taken
under its own frustum — the quad's half-extent, not this test's fixed
256 px — while the gate's own four terms are the `prefilter` counter,
which is counted over the whole catalogue ahead of any frustum. So
in-frame-and-gate-admitted is not measured here and does not follow from
these three numbers; a scoping argument may lean on the bound and not on
more. Where nothing draws, the bound is exact.

The count is float64 where the kernel is float32, so a star within a few
ulp of the screen edge can fall either side; at a 256 px slack that is not
a number anyone reads.

### The generation stamp

`stamps[star]` is the **camera generation** the star's A_V was last
marched at; the generation bumps on exactly the requests that used to
recompute everything — displacement past `RECOMPUTE_EPSILON_PC`, a moved
gate bound, a dirty mark — and `absCameraPos` is set at the bump. A star
in frame whose stamp equals the generation is skipped; one whose stamp
predates it is appended, marched when its quarter comes, and stamped. So a
rotation, which bumps nothing, appends only the stars it newly exposes,
and each star marches at most once per camera generation and only if seen.
The values are the same march at the same camera: exact, no accuracy
change, no catalogue rebuild. `slotRefills` is the CPU form and the
rotation case is its test.

**The epsilon measures from the generation's camera, never from the last
dispatch.** A quarter leaves `lastCam` where the bump set it. Reset it per
dispatch and a camera creeping under one epsilon a frame outruns the gate
for good once a flight has run — pinned in the prepass test.

### A view change is a refill request — nothing more

`wanted` is `bump || viewChanged`, so **turning the camera asks for a
refill exactly as displacing it does** and the cursor answers both the
same way: arm the compaction, then march the quarters it lists. What that
costs a star the turn newly exposes is up to `REFILL_SLICES` frames of its
last stamp's value, the same bound [The staleness this buys](#the-staleness-this-buys-and-what-sets-refill_slices) derives for
displacement — and for the same reason, since a turn at a parked camera
moves A_V by nothing at all. The star is exact once its quarter comes
round.

A turn costs no dispatch of its own: the compaction runs over every
catalogue star on every rendered frame regardless, and an armed frame adds
the producer block to a quarter of its threads ([The compaction appends
the worklist](#the-compaction-appends-the-worklist)). What a turning camera pays per frame is the march of one
class of the stars it exposed.

## The compaction appends the worklist

The compaction kernel already runs one thread per catalogue star every
rendered frame and already has the clip position. On an **armed** frame
the threads of **one residue class** — `self % REFILL_SLICES` equal to the
`quarter` uniform — also run `appendRefillWorklistTsl` after the solve:
frustum at the refill's slack, then the cache gate (`starCacheVisibleTsl`,
the four dust-independent terms over the *brightest* magnitude), then
`stamps[self] != cameraGeneration`, and a star passing all three is
appended to its Morton bucket with one `atomicAdd`
([Bucketed by Morton range](#bucketed-by-morton-range)). The arm is a
uniform the prepass holds up for `REFILL_SLICES` frames from a request, so
the four classes are built on four consecutive frames; a settled frame
pays one uniform compare per thread and reads nothing else.

**One class per armed frame, not four.** Building every class every frame
was measured first (`stellata-8cg.58.10` notes, 2026-09-19): at 1,278,785
records it read 0.90 ms per moving frame at `mw120` against the sliced
kernel's 0.57, and the excess followed the in-frame, gate-admitted
population — a stamp read, an atomic and a list write for every stale star
on every frame, four times what the sliced kernel amortised. Building a
quarter of the catalogue per frame puts the producer's data work at the
sliced kernel's rate while the frame still marches one class.

**The population is the cache gate's, not the survivor list's.** Two
reasons, each of which alone rules the survivor list out as the
population:

- Survival is decided *after* the A_V read — `solveStarTsl` adds
  `absorbAV` and re-tests the bounds before `onAlive` fires — so a star
  whose cached A_V is stale-high is culled, unlisted, and never refilled: a
  hysteresis that leaves it dark until something forces a whole fill.
- The survivor prefilter runs over the *live* pulsation phase, and a
  variable in its faint phase through the last armed frames of a move
  would then brighten at a settled camera with the A_V of wherever the
  move began. The cache gate credits every star its whole brightward
  swing, so it admits a superset and the clock moves nothing it reads
  ([What a CACHE owes](../README.md#what-a-cache-owes-that-a-per-frame-prefilter-does-not)).

Both are dust-independent and phase-independent, which is what lets the
list be built ahead of the read and marched with **no gate in the refill
kernel at all** — a listed star has passed it. Placing the block outside
the solve's prefilter is the cost of the second point: a building thread
re-evaluates the four terms the solve just read from the same record,
cache-hot, and the block sits after the solve so those reads are the
solve's to reuse.

**The refill kernel resolves star → slot.** The list carries catalogue
indices; the position table is in Morton slot order
(`../dispatch-order/README.md`), so the march reads `slotOf[self]` — the
order table's inverse — then the position, marches, and writes `av[self]`
and `stamps[self]`. The A_V buffer stays catalogue-star-indexed, as every
consumer expects.

**`slotOf` and the worklist are one buffer, and that is what pays for the
bucket key.** The compaction kernel binds **8 storage buffers**, the core
guarantee — position, statics, suppress-pulsation, A_V, survivors, args,
stamps and this table ([Binding budget](../../star/compaction/README.md#binding-budget))
— so the producer's `slotOf[self]` read cannot have a binding of
its own. It does not need one: star → slot occupies `[0, count)` of the
same buffer the producer appends into, and `RefillWorklistNodes.slotOf`
and `.worklistElement` are the two ways to address it. Nothing else may
index that node raw.

## Bucketed by Morton range

**A star is appended under its Morton slot, not its append order.** The
producer reads `slotOf[self]` for a star that has passed all three tests,
divides by `refillBucketCapacity` and adds into that bucket's counter; the
slot it gets back is the star's place inside the bucket's static region.
So the list is sorted to `REFILL_BUCKETS` (256) Morton ranges and
scrambled only *within* one, and the march reads the dust volume in
roughly the order the whole fill does — which is worth 5.2× on this pass
([Dispatch order](../dispatch-order/README.md#dispatch-order)).

**Capacity is a hard bound, and the geometry is why.** Bucket *b* spans
exactly `⌈count / REFILL_BUCKETS⌉` Morton slots and a star occupies one
slot, so no gate, no camera and no residue class can put more stars in a
bucket than it has room for — overflow is not a case that exists, and the
whole worklist is `count` rounded up to the bucket. The bound holds
whatever the producer keys the *quarter* on, which is why the quarter
stays `self % REFILL_SLICES`: free arithmetic, outermost, and it keeps the
`slotOf` read off three quarters of the threads.

**What `REFILL_BUCKETS` trades.** Raising it narrows each bucket's Morton
span — the thing the march is paid for — and costs one more step in the
kernel's search (log₂) and quadratically more in the scan below, which is
`O(REFILL_BUCKETS²)` L1 reads in one dispatch. The span that matters is a
warp's: 32 threads of a marched list of *n* stars cover `32 ·
REFILL_BUCKETS / n` buckets, and a fully sorted list would put them inside
`32 · count / n` slots — so the bucketing reaches a full sort's coherence
once a bucket holds about a warp, and buys nothing past it. At `mw120` and
1,278,785 records the quarter marched is ~16k stars, which puts 256 near
that point.

**The scan packs the buckets back into one dense dispatch.** The marched
list has to be contiguous — a dispatch over the static regions would be
one thread per catalogue star again, which is the whole thing the worklist
removed — so the compaction closes its pass with two `REFILL_BUCKETS`-wide
kernels: one copies each bucket's counter out of the atomic args buffer,
the next has thread *b* sum the copies before it into the exclusive prefix
and its last thread write `[⌈n / 64⌉, 1, 1, n]`. Both tables ride in
`refillDispatch`, which the refill kernel already binds, and both kernels
are dispatched on armed frames alone
([The refill dispatch](../../star/compaction/README.md#the-refill-dispatch)).

**Producer and refill kernel address one entry through the same two
accessors** — `bucketOf` for the key, `worklistElement(count, bucket,
offset)` for the slot — so the `bucket × capacity + offset` the two must
agree on is written once. A star appended at an address the march does not
recover is the silent-corruption case [One region](#one-region-and-the-frame-order-behind-it) describes, and the
round trip is pinned in `refill-buckets-pure.test.ts`.

**The refill kernel finds its bucket by one bit per step.** Thread *i*
walks the prefix from `REFILL_BUCKETS / 2` down, taking each step whose
prefix it has reached, and lands on the largest bucket whose prefix is at
or below *i* — its own, because an empty bucket carries its successor's
prefix and so is never the largest. `i` minus that prefix is the star's
place inside the bucket's region. `refillBucketAt` is the CPU mirror and
the empty-bucket case is its test.

## One region, and the frame order behind it

**The worklist holds one built class at a time, not four.** The prepass
runs ahead of the compaction in the frame ([The cursor](#the-cursor-and-why-a-request-never-stalls-it)), so a frame
marches the class built last frame in its own submit and only then does
the compaction reset the counters and build the next one over the same
region. The list is read before it is overwritten, every frame, by
submit order.

That is a tighter margin than four regions would leave, and it is the
invariant to hold: **a change that moves the prepass after the compaction,
or marches a class more than one frame old, corrupts the march silently**
— the entries resolve to real stars and write a plausible A_V onto them.
`planRefill`'s simulation pins it directly (the class marched is always
the class built on the preceding frame), and `verifyExtinction()` cannot,
since it refills whole first.

## The cursor, and why a request never stalls it

`planRefill` holds `owed`, the armed frames still to run — one class built
per frame — `quarter`, the class built last frame, and `built`, whether one
was. A request (camera displacement past the epsilon, a turn, a moved gate
bound, a re-packed position table, a dust chunk) sets `owed` back to
`REFILL_SLICES`; the arm is up while anything is owed, and a frame whose
predecessor built a class marches it and advances `quarter`. The prepass
runs *before* the compaction, so the class marched on frame N is the one
built on frame N−1 — one frame of lag — and the class left in the uniform
after the dispatch is the one the compaction builds and sizes on frame N.
Consume, then produce, in that order and in one `update()`.

**Every star a request makes stale is marched within `REFILL_SLICES`
frames of it, wherever in a flight the request lands.** A star's residue
never moves, so under a request every frame — a warp, where the generation
bumps each frame — its class is built every fourth frame and it is marched
the frame after, every fourth frame; and when requests stop, the arm holds
for the frames still owed, so every class is built once more from the
final generation and marched. The pure test simulates producer and
consumer over a catalogue and pins the bound tight: the last class of a
lone request marches on frame `REFILL_SLICES` exactly.

**The A/B switch parks the cursor and re-requests, rather than resuming.**
Disarming mid-flight strands the classes still owed, and at a camera that
never moves again nothing would ever ask for them, so `setEnabled(false)`
marks the pass dirty: the first re-enabled frame bumps the generation and
builds all four afresh.

**A parked cursor, and only a parked cursor, is a frame the pick mirror can
be staged on.** `warmAvReadback` refuses while anything is in flight — a
frame owed or a class built and not yet marched: a copy taken mid-flight
is superseded by the next class before the hover dwell that wanted it can
read a byte ([Cold reads](../README.md#cold-reads--the-one-behaviour-that-is-not-parity)). Nothing in flight means no
request has landed for `REFILL_SLICES` frames, camera or view, so that one
test covers a turning camera as well as a travelling one.

## The staleness this buys, and what sets REFILL_SLICES

A_V depends on camera **position** only — the ray is camera→star — so a
star's value is stale by however far the camera has moved since its quarter
last marched, at most `REFILL_SLICES` frames' worth. Extinction varies on
the dust texture's ~5 pc voxel scale, about **3 mmag of A_V per pc** of
camera displacement ([The prepass cache](../../../star-pipeline/extinction/README.md#the-prepass-cache),
which sizes `RECOMPUTE_EPSILON_PC` off the same rate). So
the error is `REFILL_SLICES × (displacement per frame) × 3 mmag/pc`.

The vantage that maximises it is inside the dust cube, flying, at any epoch
— the clock moves stars rather than the camera, and a star's own motion over
±5,000 yr is far under a voxel. At `REFILL_SLICES` = 4 and 60 fps, a 100 pc/s
fly-through through the plane is 1.7 pc per frame and 20 mmag, against the
~1.5 mag column the disc itself reaches. Outside the cube the rate is zero:
a warp's per-frame displacement is enormous and its staleness is the dust in
a segment that has none.

**It is a transient, and it closes itself.** The moment the camera settles
the flight runs out and every star is exact again within `REFILL_SLICES`
frames. Raising the constant divides the per-frame cost and multiplies that
error by the same factor — re-derive the line above before moving it.

**What the quarters buy is the spike, not the total.** A whole in-frame
refill in one frame is what crosses the vsync boundary: at 1,278,785
records the in-frame, gate-admitted set at `mw120` is ~63k stars, and
marching all of it every moving frame read 1.52 ms against a quarter's
~0.55 (`stellata-8cg.58.10` notes). Quartering changes no per-frame total
for a star; it caps what one frame pays.

## Three places a whole-catalogue dispatch is still the right one

Whole in both senses: every Morton slot, gated per thread, stamping every
star.

- **The first fill.** Until the buffer is whole, `uAvPrepassEnabled` stays
  0 and every consumer runs its own in-vertex march, 8–12 times per visible
  star per frame — dearer than the dispatch it would be waiting on. So the
  boot fill is one dispatch and the cursor parks behind it.
- **`verifyExtinction()`.** The parity check is a bit compare against one
  reference march at one camera, and a worklist flight leaves up to
  `REFILL_SLICES` cameras in the buffer. It refills whole first, so what it
  compares is the march rather than the schedule ([The prepass kernel](../README.md#the-prepass-kernel)).
- **The pick mirror.** `warmAvReadback` maps the buffer only while nothing
  is owed ([The cursor](#the-cursor-and-why-a-request-never-stalls-it)).

## The kernel bounds itself by the listed length

An indirect dispatch has no count for three to guard on — `computeIndirect`
leaves `count` null, so no early return is prepended — and the workgroup
count the scan wrote is `⌈n / 64⌉`, whose last workgroup runs past
the `n` listed entries. The kernel tests `instanceIndex < refillDispatch[3]`
itself, against the length written beside the dispatch.

**The prepass therefore binds a buffer the star layer owns, and that fixes
a teardown order.** `refillDispatch` is the compaction's; the refill
kernel's bind group holds it. So the shell disposes the prepass *before*
the star layer (`../../../stellata.ts`), or the layer releases the buffer
while a live bind group still names it. The reverse order is what reads as
correct — layers before the passes that feed them — which is why it is
written down here.

**What a missing guard costs is not an out-of-bounds write.** WebGPU
bounds-checks storage access, so the tail's read of the worklist comes back
clamped or zero, `self` resolves to a *valid* star, and the tail writes a
garbage A_V onto a real catalogue entry. `verifyExtinction()` cannot see it:
it refills whole first, and the whole dispatch is the one three's own early
return does cover. Code review is the only thing standing behind this
guard — keep it.
