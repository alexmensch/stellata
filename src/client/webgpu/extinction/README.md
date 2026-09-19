# Per-star dust extinction on WebGPU

The TSL twin of `../../star-pipeline/extinction/`: the camera→star
Edenhofer raymarch as a **compute kernel**, and the per-star A_V buffer
the star vertex stage indexes instead of re-marching. What the read
*means* — the two-tier colour routing it reddens, the clip and tap rule,
and above all the **cancellation invariant** (catalog `absmag`/`ci` are
stored de-extincted, so this stack restores extinction rather than adding
it twice) — is not re-decided here; that README owns it and a change to
either march has to ship with the mirrored build-side integral.

## Files in this area

```
src/client/webgpu/extinction/
  dust-raymarch-tsl.ts        TSL mirror of the stellata_dust_raymarch
                              chunk, over dust-raymarch-pure's clip and
                              tap constants.
                              Shared by the kernel, the parity reference
                              and the star vertex fallback exactly as the
                              GLSL chunk is.
  dispatch-order/             The Morton key the kernel dispatches in and
                              the scatter that undoes it — its own README.
  refill/                     Which slots a frame refills: the cursor, the
                              staleness bound, and the three dispatches
                              that stay whole — its own README.
  extinction-nodes.ts         The two slots as nodes — the dust volume
    (+ test)                  (texture) and the A_V cache (storage
                              buffer) — with their placeholders and the
                              attach-time swap (§ Two nodes, one owner).
  extinction-prepass-webgpu.ts  WebGpuExtinctionPrepass — one compute
    (+ test)                  thread per star into a star-indexed float
                              storage buffer, behind ExtinctionPrepassSeam.
  extinction-parity.ts        The kernel's parity instrument: the same
                              march as a fragment pass, bit-compared
                              against the buffer (§ The prepass kernel).
```

## What the port did NOT re-express

- **No `EXT_color_buffer_float` verdict.** Storage buffers and compute
  are core WebGPU, so `supported` is constant true and there is no
  fallback-because-the-hardware-cannot branch to port. The *A/B* fallback
  survives — `setExtinctionPrepassEnabled(false)` still parks the vertex
  stage on its in-vertex march, which is what makes the prepass win
  measurable on identical scenes.
- **No `gl.readPixels`.** § Cold reads.
- **No texture layout.** Star *i* is element *i* of a `count`-long float
  buffer; its position is element *i* of a `count`-long vec4 buffer the
  kernel fills and walks in an order of its own
  (`dispatch-order/README.md` § Dispatch order).
  `AV_TEX_WIDTH` × `⌈count/1024⌉`, `packPositionsRgba` and the
  `(i % 1024, i / 1024)` arithmetic are the WebGL2 twin's — and the
  parity reference's, which draws that layout on purpose (§ The prepass
  kernel). The consumers' index is the instance index itself, and the
  mirror draws' `iSourceIdx` indirection is untouched.

The algorithm, the tap count and the `RECOMPUTE_EPSILON_PC` displacement
gate are the same, so an idle camera still costs zero.

## Two nodes, one owner

`ExtinctionNodes` holds both slots for the whole boot and `boot-webgpu.ts`
constructs exactly one. That single ownership is load-bearing in both
directions:

- **The dust volume is sampled from two places** — the kernel and the
  star vertex stage's fallback march. They share the node by object
  identity, so the shell's one `attachDust` reaches both. Two nodes would
  give a bug whose symptom is that the A/B toggle changes the picture:
  one branch sampling dust, the other an empty placeholder.
- **The A_V slot is written by the pass, not by the shell.** The prepass
  points it at its own buffer in its constructor and back to the
  placeholder on dispose. The shell holds only the seam handle. The kernel
  writes *through the same node object* the vertex stage reads: access is
  a property of the shader stage, not the node, so one node is
  `read_write` in the kernel and `read` in every draw
  (`../tsl/README.md` § Storage attributes).

**The volume placeholder is marked `needsUpdate` at construction**, and
it bites: an unmarked texture gets three's shared 1×1 **2D** substitute,
which puts a 2D view on the `texture_3d` binding and invalidates the bind
group — taking the whole submit with it, so every layer in the scene goes
dark rather than just the dust read. Both slots are bound every frame
regardless of their gate (it is a runtime branch; both arms compile), so
this has to hold from the first frame, before any `attachDust`.
`createVoxelTexture` deliberately does not mark — that is the uploader's
job, paired with `initTexture` in an order that matters
(`../../loaders/README.md` § Dust voxel upload) — so a placeholder from
that factory marks itself. Pinned in the test, which fails without it.

The A_V placeholder is a one-float `StorageBufferAttribute`. Its WGSL
declaration is a runtime-sized array, so the swap to the real
`count`-long buffer rebinds without rebuilding any pipeline, and three
rebinds on its own when it sees a different attribute behind the node.

The pair is **boot-scoped**, and `WebGpuSeam.dispose()` is the only path
that frees it — the shell calls that after every layer and the prepass,
because those hand their slots back to these placeholders on the way out.
The placeholder texture is disposed there; the placeholder buffer's 4
bytes live with the renderer, which is the only thing that frees a
storage attribute no prepass ever owned. Any future boot-scoped
allocation in `boot-webgpu.ts` belongs on the same path; nothing else
reaches it.

`uAvPrepassTex` in the shared map therefore stays null for a WebGPU
boot's whole life. It is a WebGL texture slot; here the consumers index
the buffer slot directly.

## The prepass kernel

One `Fn`: the thread reads position `sliceBase + instanceIndex` out of a
read-only vec4 storage buffer, marches from `absCameraPos` to it with the
shared `dustRaymarchAvTsl`, and assigns the result to the A_V element the
slot → star table names (`dispatch-order/README.md` § Dispatch order).
three's default workgroup of 64, and **the kernel's own bound on that slot**
rather than three's: three's early return compares `instanceIndex` against
the node's `count`, which a sliced dispatch no longer reaches, and a slice's
workgroup tail runs past the slice — past the catalogue, on the last one
(`refill/README.md` § The kernel bounds its own slot).
`update()` is one `renderer.compute(kernel, slice)` — its own submit,
exactly as the fragment pass was its own render (`docs/render-rules.md`
§ 8), and it binds no render target, so the ends-at-the-canvas contract
the fragment twin kept has nothing here to hold. Pinned as
"never touches the render-target binding".

**Positions are vec4, not vec3, deliberately.** WGSL has no packed vec3
in a storage buffer, and an itemSize-3 storage attribute is the one
three silently re-strides (`../README.md` § One writer per buffer per
submit). All three buffers are owned outright by the prepass —
allocated, filled once, released through `disposeStorageAttribute` — and
none is a vertex attribute anyone uploads through `DirtyItemUploader`,
so `iPosition` and the binaries partial-upload contract are untouched.

**Sampling is identical across the three stages that run this march.**
A compute or vertex stage has no implicit derivatives, so three emits
`textureSampleLevel(…, 0)` there; the fragment prepass sampled with
`textureSample` at an implicit level, which on the mip-less volume is
the same level 0. Same TSL graph, same WGSL arithmetic — which is why the
parity check below is a **bit** comparison and not a tolerance.

**`stellata.verifyExtinction()`** is that check: it marches every star
once more as a fragment pass over the *same* position buffer, at the last
computed camera, into an R32F target of the WebGL2 layout, reads both
back and compares float32 bit patterns over the whole catalogue —
`A_V parity: N stars, bit-identical`, or the count that differ with the
first offender and the largest gap. It refills the whole catalogue first,
so one camera stands behind the buffer it compares (`refill/README.md`
§ Three places). The target exists for the call only.
Run it at Sol default and on a Galactic-centre sightline (the bead's
smoke views); a nonzero count there is a finding about the two stages'
compilation, not a tolerance to widen.

**The reference target is dispatch-slot-indexed, not star-indexed.** The
fragment reads position texel *i*, which is slot *i*, so the texel it
writes carries star `order[i]`; `scatterByOrder` puts the readback into
star order before the compare, moving bit patterns rather than values so
that a NaN payload stays distinguishable. Both offsets in the report are
therefore catalogue indices, as they were when the kernel dispatched in
catalogue order. A permutation mismatch between the two tables surfaces
here as a near-total mismatch rather than as a tolerance —
`A_V parity` is the acceptance for any change to the ordering.

### What this pass discharges of the buffer-writer requirements

Of the four requirements the single-writer audit put on this design
(bead `stellata-0it.15`, design field):

- **Per-draw addressing (1)** is met without slots. The A_V buffer is
  written once per recompute by one dispatch, ahead of the frame's render
  submit, and every star draw in that submit — three main passes and
  their local-mirror clones — wants the *same* bytes.
- **The itemSize-3 uploader trap (4)** is avoided by construction: the
  position table is vec4 and the A_V table is float, both owned outright,
  and no itemSize-3 attribute moved.
- **The prefix-sum router (2)** and **the implicit draw count (3)** are
  the compaction's (`../star/compaction/README.md` § The buffer-writer
  requirements, discharged), which keeps `iPosition` off an itemSize-3
  storage attribute the way this pass does — it reads the same array
  through an itemSize-1 table instead.

**The A_V buffer stays catalogue-star-indexed.** The compaction resolves
its survivor-list slot to the star before reading `av.element(self)`, so
the cold-read path (§ Cold reads) and any readback design over it key on
the catalogue index as before.

## What it costs, and what it holds

The first two rows are the WebGL2 pass's unchanged in size — the port
moved the work to a compute stage and the slot → star table is the one
thing it added. **Re-derive rather than trust them**: they are
`recordCount` (388,071 —
`../../../../scripts/catalog/build-catalog-expected.json`) × the element
size, and all three move with the catalog. `debug.memory()` prices the
live app (`../../debug/memory/README.md`), and on a WebGL2 boot it
*measures* the A_V target rather than taking this table's word.

| Resident | Size |
| --- | --- |
| A_V buffer (one float32 per star) | 388,071 × 4 B ≈ 1.48 MiB |
| Position buffer (one vec4 float32 per slot) | 388,071 × 16 B ≈ 5.92 MiB |
| Slot → star table (one uint32 per slot) | 388,071 × 4 B ≈ 1.48 MiB |

So ~8.9 MiB of video memory for the pass's whole life, plus the ~5.9 MiB
`Float32Array` the position attribute keeps on the JS heap after upload
and the ~1.5 MiB `Uint32Array` behind the order table, which the parity
check reads (§ The prepass kernel). **The buffer and that CPU copy are one
array**, so `dispose()` drops the field as well as releasing the
attribute — either reference alone keeps the 1.48 MiB alive.
The WebGL2 twin's `DataTexture` holds the position copy the same way. All
survive on an integrated or mobile GPU without argument.

The pick mirror (§ Cold reads) is a third heap allocation, the A_V row's
1.48 MiB again — but only from the first pointer event that asks for it,
and re-allocated per recompute the pick actually reaches, never per
recompute.

**What does not survive everywhere is the vertex stage's right to read the
buffer at all.** The WebGL2 layout's floor was `maxTextureDimension2D`,
which 1024 clears on every device; a storage buffer read from a vertex
stage answers to `maxStorageBuffersInVertexStage` instead, and that is
**zero** at WebGPU's compatibility feature level. So the floor this cache
sets is no longer free, and it is no longer this folder's to keep: the
boot refuses such a device outright (`../tsl/README.md` § Storage
attributes), which is what makes `supported` constant true here honest
rather than merely untested.

**A full recompute is at most ~37M volume samples**: one thread per
star × `DUST_TAPS_MAX` (96), 388,071 × 96; at Sol the tap rule spends
~44 per star, ~17M (`../../star-pipeline/extinction/README.md` § The
march). The cap binds wherever the in-cube path runs past
`DUST_TAP_PC × DUST_TAPS_MAX` ≈ 960 pc, so from outside the cube the
ceiling is very nearly the per-admitted-star cost. **None of those
figures is a time**: the same README records two dwells in which a 35%
tap cut did not resolve against the band, because most of this kernel's
cost is per-thread. That is the per-recompute ceiling, and a recompute is
spread over `REFILL_SLICES` frames (`refill/README.md`), so a warp — which
asks for one on every frame, the camera moving more than
`RECOMPUTE_EPSILON_PC` between them — pays that fraction of it per frame
rather than the whole. The moving camera is still the case to measure, not
the idle one. Every canon vantage is idle, so
pricing it takes the forced-recompute lever
(`../../debug/frame-cost/passes/README.md` § The extinction rows). An idle
camera costs zero, and what the gate below skips never reaches the march
at all — from far outside the disc that is very nearly all of it.

**On a WebGPU boot `debug.memory()` cannot price either row.** Both bind
through TSL nodes rather than a `uniforms` slot, so the walk reaches
neither and the star materials surface as `unknown`-basis rows instead —
flagged, not silently dropped. Until `8cg.42` changes that, this table is
the authority on that backend, which is the reason it states the
arithmetic and not just the totals.

## The cache gate

The kernel marches only stars that can reach the display, on the **same
four dust-independent terms** the star vertex stage prefilters with —
spectral mask, distance band, cull bound, taper bound. One expression
serves both (`../star/star-visibility-tsl.ts`); a second statement of it
here would be a prepass and a vertex stage that disagree about who is
visible, which reads as a wrongly un-reddened star rather than as a
failure. A skipped star's element is assigned **zero**, not left alone,
so the buffer stays a function of the dispatch and `verifyExtinction()`
keeps its total bit compare — the reference march runs the identical gate
closure (§ The prepass kernel).

**What it saves is a function of the vantage, and collapses with
aperture.** Share of the march that is wasted without the gate, unaided
eye (cull 10.56), real catalogue / the V≤11 synthetic set: 15.2% / 12.7%
at Sol, 27.7% / 24.6% at 200 pc, 76.3% / 70.7% at 1 kpc, 97.2% / 93.1% at
3 kpc, 99.5% / 97.8% at the Galactic centre, 100% at the halo and Local
Group vantages — where no star can render and the ungated kernel marched
all 1,278,785. At 200 mm aperture (limit ~15.1, cull 17.86) the same
figures are 0.2% at Sol and 4.6% at 3 kpc: the gate stays exact, it stops
paying.

**What it costs is paid at every vantage, and at `lg` it is currently a
net loss.** The gate itself is four scattered reads into the 17.8 MiB
static record table plus a log and four compares, on all 388,071 threads,
whether or not the march it guards would have done anything. Measured on
the forced-recompute dwell (`gpu-compute` p50, ms): sol 3.195 → 1.729,
earth 3.285 → 1.815, mw50 2.697 → 1.392, mw120 2.634 → 1.363 — and
**lg 0.982 → 1.316, +34%** (`.perf-runs/2026-09-18/8cg576-lg-clean.json`,
against `cns-real-recompute-all.json`). `lg` is not an anomaly to explain
away: that run predates the clip, when 48 taps spread over a 1 Mpc
segment of which only the last ~1.25 kpc was inside the dust cube, so the
march the gate skipped there was already a no-op and only the gate's own
cost landed. The clipped march spends every tap inside the cube at `lg`,
so the march is genuinely expensive there and the row flips to the
table's largest saving; a camera-outside-the-cube bypass is deliberately
**not** built. Re-measured there by `stellata-8cg.57.7`; do not quote the
`lg` figure above as current.

**The two stages compute `dPc` in different frames** — this pass in
absolute heliocentric coordinates, the vertex stage in the floating-origin
local ones — so their last float32 bits can disagree, and a star sitting
within ~1e-4 mag of a bound can be gated here and admitted there. Neither
bound leaks anything: at the cull bound the vertex stage discards the star
too, and at the taper bound the soft taper is exactly zero, so the star
the disagreement can reach contributes no light from any vantage at any
epoch. Do not close it by marching in local coordinates — the positions
here are the pristine absolute ones and the march's bit-parity with the
reference is what `verifyExtinction()` checks.

### What a CACHE owes that a per-frame prefilter does not

The vertex stage re-runs its prefilter every frame, so it needs no
invalidation. Three obligations fall out of caching the same test:

- **The bounds are watched, not pushed.** `STAR_VISIBILITY_BOUND_KEYS`
  (`../star/star-visibility-tsl.ts`) is the complete
  input set, and `update()` compares each against the value it last
  dispatched with — raising the aperture raises `uCullMag`, a filter
  change moves the mask or the band, and neither displaces the camera.
  A watch rather than a `markDirty()` at each writer is what keeps a
  *future* writer of those uniforms from silently skipping the
  invalidation. The list is the authority: the type of the value objects
  and the watch loop both derive from it.
  **Every key on it must stay free of the per-frame scene adaptation**,
  or this cache refills the whole catalogue's march on every frame
  instead of on every settle (§ What it costs, and what it holds, for the
  sample count that is). `uThresholdMag` is the one that could move: it is
  `m_lim + MAG_PER_STOP·ev`, and `ev` is the user's discrete trim, with
  the adaptation cut held out of it on exactly this ground
  (`../../hdr/exposure/README.md` § Adaptation is deliberately absent —
  which names a dirty-tracked cache keyed on the cut as the thing that
  would thrash). Folding `dm` into a bound here is silent: the answers
  stay correct and the cost goes up by the whole march.
- **The gate reads nodes this pass owns**, mirroring those six slots,
  because the shared registry's `sync()` runs *after* this pass
  dispatches (`../../stellata.ts` `animate`). A kernel on the shared
  nodes would gate on the previous frame's instrument while the watch had
  already seen the new one — and the two disagreeing is a star admitted
  by the vertex stage that no dispatch ever fills.
- **The model clock moves nothing it reads.** A pulsating variable is
  credited its whole brightward swing (`−0.5 · iAmplitudeMag`) instead of
  its live phase, so the answer is phase-independent and `uModelDays`
  is deliberately not a watched bound. The credit only ever *admits*
  stars, so every stage's own prefilter passes a subset of this one —
  which is also why the glow pass's looser taper bound is the one taken.

**Positions are the fourth input, and they are not static.** The model
clock's space-motion pass rewrites `catalog.positions` in place on every
epoch bucket it crosses (`../../star-pipeline/star-frame/README.md`), and
this pass packed a copy at attach. `refreshPositions()` re-packs it —
which the shell calls from the epoch advance itself — so the march and
the gate both follow the stars over the ±5,000 yr the clock reaches. The
Morton order is *not* rebuilt: it buys memory coherence rather than
correctness, and re-sorting would cost ~77 ms per bucket crossing
(`dispatch-order/README.md` § Dispatch order).

## Cold reads — the one behaviour that is not parity

`readAvMag(idx)` is synchronous on WebGL (`gl.readPixels`, memoised) and
the pick paths call it that way: a star's extinction decides whether the
renderer put a pixel on screen for it, so a pick gated on the intrinsic
magnitude selects stars the frame drew black.

WebGPU has **no synchronous readback**, and that is not a latency to
shorten but a shape the design has to take. `getArrayBufferAsync` stages
a `copyBufferToBuffer` and maps it, resolving frames later — so a copy
issued *by* the pick lands after the verdict it was meant to decide, and
the caller has already read `null` as "no cache, not no dust"
(`../../star-pipeline/extinction/README.md` § Reading A_V back) and erred
toward *pickable*. No per-star refinement of that read closes it. The
value has to be on the CPU **before** the pick asks.

**`warmAvReadback()` is the whole mechanism**: one mapped copy of the
entire `count`-long buffer into a `Float32Array` mirror, which
`readAvMag` then answers out of — exactly, for every star in the
catalogue, at no further GPU cost until the next recompute. The pointer
events that precede a pick are what drive it (`onPickImminent` on
`../../hover/hover-engine.ts` → `Stellata.notifyPickImminent`), so the
280 ms hover dwell and the click FSM's own hold each cover the map's
latency and the **first** hover already rejects a star behind heavy dust.

**The whole table, not the candidates, because the event does not know
them.** A candidate list is what the pick's own catalogue scan produces,
one dwell later; the pointer event that has to start the copy knows only
that *a* pick is coming. Warming what the event knows means warming
everything — and 1.48 MiB copied once beats racing the scan.

**The generation is what bounds the cost, not the event rate.** The
mirror is dropped on every recompute and re-read at most once per
recompute, so a `pointermove` sweep across a dusty field costs one copy
and a still pointer costs none. The same counter drops a read that
resolves against a superseded buffer — the WebGL twin's `avCache.clear()`
expressed for a promise that can outlive the thing it was reading. A map
that *fails* consumes that one attempt rather than re-arming, so a device
refusing the copy cannot turn a pointer sweep into a 1.48 MiB-per-event
drip.

**A refill still cycling warms nothing at all**, which is the other half of
that bound and the one the generation counter alone does not give. A warp
or a focus lerp asks for a refill every frame, so the cursor never parks,
the generation advances every frame, and a copy issued against one is
superseded before the 280 ms dwell that wanted it can read a byte — every
such copy is spent and dropped, at 1.48 MiB a frame for as long as the
motion lasts. `warmAvReadback` therefore returns early while the cursor is
mid-cycle, and the pick reads `null` and errs pickable across that stretch
either way. **The gate is the cursor, not the recompute**: a dust chunk
landing on a parked camera recomputes too, and the frame its cycle parks on
is one a pick can still be staged for. The frame-cost lever that forces a
recompute every frame at a parked camera is the same shape, and keying this
gate on the recompute instead would swallow it — it would also spend 1.48
MiB a frame on a live pointer, which is why that lever is dwell-only
(`../../debug/frame-cost/passes/README.md` § The extinction rows). A parked
cursor also means the buffer belongs to one completed cycle rather than to
a half-written one, which is the second thing the mirror needs and the
camera the old gate watched never said (`refill/README.md` § Three places).

A drag announces nothing either: hover is suppressed for its duration
anyway, and the camera motion under it would invalidate each copy before
the next event. The residual hole is that shape and only that shape — a
pick dispatched while the camera is still crossing more than
`RECOMPUTE_EPSILON_PC` per frame reads `null` and errs pickable, as every
pick did before. Hover cannot reach it (it needs a `pointermove` the
drag latch swallows); a click during a focus lerp can.

Why not the alternatives: reading the buffer on every recompute is
1.5 MB per read and a warp recomputes every frame, which spends it
exactly where nobody picks; marching on the CPU needs the ~128 MiB voxel
grid the loader uploads and drops, and would be a second implementation
of the integral free to drift from the shader's.

The copy goes through `getArrayBufferAsync` with a **null target**, which
creates its staging buffer per call and destroys it after the map. three
also offers a `ReadbackBuffer` target that holds one across calls; it
trades 1.48 MiB of VRAM for the renderer's whole life against a create
and destroy per warm, and with the camera gate above a warm is a
per-settle event rather than a per-frame one. On the integrated and
mobile floor this folder is sized for, the resident megabyte is the
dearer half of that trade.
