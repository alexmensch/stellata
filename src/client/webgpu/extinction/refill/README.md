# Spreading the extinction refill across frames

Which slots the A_V cache refills on a given frame. The kernel and the
cache gate are the parent's (`../README.md`); this folder owns only the
schedule, and `refill-slices-pure.ts` is the whole of it — a cursor, a
request flag, and one function that turns them into this frame's dispatch.

```
src/client/webgpu/extinction/refill/
  refill-slices-pure.ts       REFILL_SLICES, refillSliceLength, planRefill
    (+ test)                  and the cursor they move — which slots this
                              frame dispatches, or none.
  refill-decision-pure.ts     The kernel's per-slot verdict in frustum mode
    (+ test)                  (slotRefills), the slack, and the view it
                              tests against (composeViewProjectionAbs,
                              sameView). The rotation case is pinned here.
```

## Only what is in frame

A_V is read for the stars the compaction lists — the ones whose quad can
touch the viewport — and for nothing else, so a refill of everything the
prefilter admits marches, at the `mw120` canon vantage, some five times
the stars any draw will consult. The kernel therefore tests the frustum
itself, in **frustum mode**, on the position each thread already holds:

1. `viewProjectionAbs × vec4(absPos, 1)` — projection × view × T(−worldOffset),
   composed on the CPU in float64 each frame from the camera the shell
   hands `update()`, so clip space comes straight off the absolute
   position table. The same projection × view the compaction kernel
   tests against, with the origin shift folded in — **and the same camera,
   which is a frame-order constraint, not an identity**. The rides inside
   the layer fan-out move the camera, so the shell runs this pass *after*
   the fan-out and the compaction after that (`../../../stellata.ts`
   `animate`). Run it before, and a warp or focus lerp leaves the two
   kernels disagreeing about what is in frame on exactly the frames the
   camera is moving fastest — the compaction lists a star for drawing whose
   refill never saw it.
2. `starQuadOffscreenTsl` (`../../star/compaction/frustum-tsl.ts`) with a
   fixed half-extent of `EXTINCTION_FRUSTUM_SLACK_PX` in place of the
   quad's size, which is not known here — it needs the size solve, which
   needs the A_V being computed. The pinned focal star counts as seen
   whatever its projection, as it does in the compaction.
3. Out of frame → the thread returns before the gate's four static-table
   reads, leaving the star's A_V and stamp as they were. In frame → the
   **generation stamp** below decides.

**The slack's failure mode is a stale A_V, never a missing star.** The
compaction still lists a star whose quad overlaps the screen edge by more
than the slack, and the vertex stage draws it with its last A_V. That is a
resolved disc hundreds of px wide with its centre well past the edge — a
close-approach case, where the camera's AU-scale motion moves A_V by
nothing. State the vantage before narrowing the slack.

### The generation stamp

`stamps[star]` is the **camera generation** the star's A_V was last
marched at; the generation bumps on exactly the requests that used to
recompute everything — displacement past `RECOMPUTE_EPSILON_PC`, a moved
gate bound, a dirty mark — and `absCameraPos` is set at the bump. A slot
in frame whose stamp equals the generation is skipped; one whose stamp
predates it marches and is stamped. So a rotation, which bumps nothing,
marches only the stars it newly exposes, and each star marches at most
once per camera generation and only if seen. The values are the same
march at the same camera: exact, no accuracy change, no catalogue rebuild.
`slotRefills` is the CPU form and the rotation case is its test.

**The epsilon measures from the generation's camera, never from the last
dispatch.** A slice leaves `lastCam` where the bump set it. Reset
it per dispatch and a camera creeping under one epsilon a frame outruns the
gate for good once a cycle has run — pinned in the prepass test.

### A view change is a refill request — nothing more

`planRefill`'s `wanted` is `bump || viewChanged`, so **turning the camera
asks for a refill exactly as displacing it does** and the cursor answers
both the same way: one slice a frame, wrapping while requests keep
arriving, parking when they stop. Past the first fill no frame dispatches
more than `refillSliceLength` slots, whatever the camera did.

What that costs a star the turn newly exposes is `REFILL_SLICES` frames of
its last stamp's value, the same bound § The staleness this buys derives
for displacement — and for the same reason, since a turn at a parked camera
moves A_V by nothing at all. The star is exact once its slice comes round.

**Never dispatch the whole slot range on a view change**, however little of
it can march. The tempting version buys a newly exposed star its exactness
one frame sooner and costs a thread per catalogue star on every turning
frame; each of those threads pays a `u32` order read, a `vec4` position
read and a mat4×vec4 before it can early-out — 20 B per star, 7.8 MB at
388,071 records and 25.6 MB at 1,278,785, per frame, for as long as the
camera turns.

Order of magnitude for that, from two archived runs rather than a
differential — different commits, so read it as a bound and not a price:
57.6's gated kernel over all 388,071 threads at `lg`, where the march is a
no-op and every thread pays only the gate, sits at **0.67 ms**
(`.perf-runs/2026-09-18/8cg576-gated-recompute-all.json` compute p50 1.336
under the forced-recompute lever, against `8cg585-real-pin.json`'s 0.662 with
no recompute running, which is the compaction alone). The frustum prologue
does strictly less per thread than that gate, so it lands under that at
388k — against a slice's quarter of it, on the commonest thing a user does.

**Whole mode** — the first fill and `verifyExtinction()` — skips the
frustum test and the stamp check and stamps every star, so the parity
instrument's total bit compare is unchanged. Until the shell has supplied
a view, every dispatch runs in whole mode over its slots.

## The spike is the problem, not the total

A whole-catalogue refill is one thread per star × 48 taps — 18.6M volume
samples at 388,071 records, and 61M at the V≤11 synthetic set's 1,278,785.
Measured on the forced-recompute dwell before the cache gate landed: 2.4–2.9
ms at 388,071 and 7.8–8.2 ms at 1,278,785, on every frame the camera moves
more than `RECOMPUTE_EPSILON_PC`. At 1.28M that took mw50's wall-clock median
from 16.7 to 33.3 ms — a frame crossing the vsync boundary, which is a thing
the user sees, where the same total spread under the boundary is not.

Spreading changes no per-frame total: one slice of `1/REFILL_SLICES` of the
catalogue dispatches per frame, so a whole refill takes `REFILL_SLICES` frames
and each costs that fraction.

**The run total is not fixed, and a lone request is what moves it.** The wrap
below restarts the cursor at slot 0 and clears `pending`, so the cycle it
starts runs all `REFILL_SLICES` slices rather than the *k* the request still
owed — a request landing at slice *k* costs `(REFILL_SLICES − k) +
REFILL_SLICES` slices, up to two whole refills for one request, worst when it
lands early in a cycle. A camera that keeps moving asks every frame, where the
cycling is continuous and nothing is spent twice, so what pays that ceiling is
the isolated request: one dust chunk, one aperture change, the last frame of a
warp. Parking the cursor at the slot the request arrived at recovers it, at a
third state field and a park-mid-cycle branch (`stellata-8cg.58.8`).

## The cursor, and why a request never restarts it

`planRefill` holds a `base` — the next slot to refill, or `count` for a
parked cursor — and a `pending` flag. A request (camera displacement past
the epsilon, a moved gate bound, a re-packed position table, a dust chunk)
**starts** a cycle from a parked cursor and otherwise only sets `pending`.
The cursor advances one slice per frame, and on reaching the end wraps to
slot 0 if `pending` is set, or parks.

Restarting on every request is the obvious spelling and it starves the
catalogue: camera displacement fires on **every** frame of a warp, and an
epoch scrub fires `refreshPositions` nearly as often, so slice 0 would be
refilled forever and every other star would keep the value its last
completed cycle gave it.

**Every star is refilled within `REFILL_SLICES` frames of any request,
wherever in the cycle the request lands.** With the cursor at slice *k* when
a request arrives, slices *k…S−1* refill over the next *S−k* frames, the
wrap then covers *0…k−1* over the *k* after that, and *(S−k) + k = S*. That
is the bound the staleness below rests on, and the test that pins it sweeps
the request across every position in the cycle.

## The staleness this buys, and what sets REFILL_SLICES

A_V depends on camera **position** only — the ray is camera→star — so a
star's value is stale by however far the camera has moved since that star's
slice ran, at most `REFILL_SLICES` frames' worth. Extinction varies on the
dust texture's ~5 pc voxel scale, about **3 mmag of A_V per pc** of camera
displacement (`../../../star-pipeline/extinction/README.md` § The prepass
cache, which sizes `RECOMPUTE_EPSILON_PC` off the same rate). So the error
is `REFILL_SLICES × (displacement per frame) × 3 mmag/pc`.

The vantage that maximises it is inside the dust cube, flying, at any epoch
— the clock moves stars rather than the camera, and a star's own motion over
±5,000 yr is far under a voxel. At `REFILL_SLICES` = 4 and 60 fps, a 100 pc/s
fly-through through the plane is 1.7 pc per frame and 20 mmag, against the
~1.5 mag column the disc itself reaches. Outside the cube the rate is zero:
a warp's per-frame displacement is enormous and its staleness is the dust in
a segment that has none.

**It is a transient, and it closes itself.** The moment the camera settles
the cycle runs out and every star is exact again within `REFILL_SLICES`
frames. Raising the constant divides the per-frame cost and multiplies that
error by the same factor — re-derive the line above before moving it.

## Three places a whole-catalogue dispatch is still the right one

Whole in both senses: every slot, and whole mode (§ Only what is in
frame).

- **The first fill.** Until the buffer is whole, `uAvPrepassEnabled` stays
  0 and every consumer runs its own in-vertex march, 8–12 times per visible
  star per frame — dearer than the dispatch it would be waiting on. So the
  boot fill is one dispatch and the cursor parks behind it.
- **`verifyExtinction()`.** The parity check is a bit compare against one
  reference march at one camera, and a spread refill leaves up to
  `REFILL_SLICES` cameras in the buffer. It refills whole first, so what it
  compares is the march rather than the schedule (`../README.md` § The
  prepass kernel).
- **The pick mirror.** `warmAvReadback` maps the buffer only while the
  cursor is parked. A copy issued mid-cycle is superseded by the next
  slice before the hover dwell that wanted it can read a byte, which is the
  same argument the camera-under-way gate it replaces was making — and a
  parked cursor means nothing has asked for a refill, camera or view, so
  that one test covers a turning camera as well as a travelling one
  (`../README.md` § Cold reads).

## The kernel bounds its own slot

`instanceIndex` is bounded against the **dispatch**, not the catalogue. three
prepends `if (instanceIndex >= count) { return; }` using the compute node's
own `count`, and a dispatch of `plan.length` threads never climbs that far, so
the guard is dead code under slicing. Every slice's trailing workgroup
therefore overruns its slice — harmlessly into the next slice's slots for all
but the last, whose tail runs past the catalogue. The kernel tests
`sliceBase + instanceIndex < count` itself.

**What a missing guard costs is not an out-of-bounds write.** WebGPU
bounds-checks storage access, so the tail's read of `order[slot]` comes back
clamped or zero instead, `self` resolves to a *valid* star, and the tail
writes a garbage A_V onto a real catalogue entry. `verifyExtinction()` cannot
see it: it refills whole first, and a whole dispatch is the one case three's
own early return does cover. Code review is the only thing standing behind
this guard — keep it.
