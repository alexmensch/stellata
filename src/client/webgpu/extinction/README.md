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
  refill/                     Which slots a frame refills and which of them
                              march: the cursor and its staleness bound,
                              the in-frame test and the per-star camera
                              generation stamp, the three dispatches that
                              stay whole — its own README.
  mirror/                     The pick's CPU copy of the A_V table: the
                              mapped readback, its staging gate and the
                              epoch that drops a superseded copy — its own
                              README.
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
| Camera-generation stamp (one uint32 per star) | 388,071 × 4 B ≈ 1.48 MiB |
| Star → slot table (one uint32 per star; `#av-refill=survivors` only) | 388,071 × 4 B ≈ 1.48 MiB |

So ~10.4 MiB of video memory for the pass's whole life (~11.9 under the
survivor probe, `refill/README.md` § The survivor-driven probe), plus the ~5.9 MiB
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
figures is a time**: the same README records the same-commit pair in
which roughly half of this kernel's cost is a per-thread floor no tap
count touches, and the other half is the march. That is the per-recompute ceiling, and a recompute is
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

**Ahead of those four reads sits the frustum**, in every dispatch but the
whole-mode ones: a thread whose star is out of frame returns on its
position alone, before touching the static table, and one whose star is
already stamped at this camera generation returns after one more read
(`refill/README.md` § Only what is in frame). The four scattered reads
that made the gate a net loss at `lg` are therefore paid by the in-frame
population only.

**That population is measured, and at `lg` it is the whole catalogue.**
Share of the catalogue the frustum admits, real set / the V≤11 synthetic
set (`.perf-runs/2026-09-19/8cg596-survivors-real.json` and
`8cg596-survivors-m11.json`, 1280×800 at dpr 2): 46% / 45% at `mw120`,
17% / 19% at `sol`, 6.9% / 7.1% at `earth`, 18% / 19% at `mw50`, and
**100% at `lg`** at both sizes — every star is in frame there, so the
frustum returns nothing and all four reads are still paid on every thread
at the one vantage where the gate saved least. The counts move with
viewport and field of view, so a reading at another buffer size is not
this one's comparison.

**What it saves is a function of the vantage, and collapses with
aperture.** Share of the march that is wasted without the gate, unaided
eye (cull 10.56), real catalogue / the V≤11 synthetic set: 15.2% / 12.7%
at Sol, 27.7% / 24.6% at 200 pc, 76.3% / 70.7% at 1 kpc, 97.2% / 93.1% at
3 kpc, 99.5% / 97.8% at the Galactic centre, 100% at the halo and Local
Group vantages — where no star can render and the ungated kernel marched
all 1,278,785. At 200 mm aperture (limit ~15.1, cull 17.86) the same
figures are 0.2% at Sol and 4.6% at 3 kpc: the gate stays exact, it stops
paying.

**What the gate's own reads cost was paid at every vantage before the
frustum sat ahead of them, and at `lg` it was a net loss.** Four scattered
reads into the 17.8 MiB static record table plus a log and four compares,
on all 388,071 threads, whether or not the march it guards would have done
anything. Measured on the forced-recompute dwell (`gpu-compute` p50, ms):
sol 3.195 → 1.729, earth 3.285 → 1.815, mw50 2.697 → 1.392, mw120
2.634 → 1.363 — and **lg 0.982 → 1.316, +34%**
(`.perf-runs/2026-09-18/8cg576-lg-clean.json`, against
`cns-real-recompute-all.json`). `lg` is not an anomaly to explain away:
that run predates the clipped march, when 48 taps spread over a 1 Mpc
segment of which only the last ~1.25 kpc was inside the dust cube, so the
march the gate skipped there was already a no-op and only the gate's own
cost landed. The clipped march spends every tap inside the cube at `lg`,
so the march is genuinely expensive there and the row flips to the table's
largest saving; the frustum test now returns the out-of-frame threads
before the gate reads, and a camera-outside-the-cube bypass is deliberately
**not** built. Do not quote the `lg` figure above as current.

**Current, on the same instrument and lever** — the frustum ahead of the
gate and the refill sliced, `.perf-runs/2026-09-19/8cg575-frustum-recompute-all.json`
(`gpu-compute` p50, ms, 388,071 records): mw120 0.526, sol 0.525, earth
0.487, mw50 0.394, **lg 0.926**. Against the gated column above that is −31%
at `lg` and −61% to −73% elsewhere, and `lg` now sits below its own
pre-gate 0.982 — the net loss there is gone. Two changes are folded into
that column and on the real catalogue it cannot separate them: the slicing
dispatches a quarter of the slot space per frame, and the frustum returns the
out-of-frame threads inside it. Every run quoted above predates 58.4's
clipped march; **this tree's own figure is the same-commit pair at
`1d5f934e`** (`.perf-runs/2026-09-19/poststack-refill-off.json` and
`-refill-on.json`, 960 frames, readback one in four): forced 0.452 / 0.587
/ 0.507 / 0.393 / **0.923** against the compaction alone at 0.286 / 0.392
/ 0.390 / 0.306 / 0.693 (mw120 / sol / earth / mw50 / lg), so the refill
costs 0.09–0.23 ms per forced frame — under the 0.25 ms band at every
vantage, `lg` included.

**The frustum's own share is separable at 1,278,785**, where a run exists at
the slicing's tip with the same lever and flags. `gpu-compute` p50, ms:
`cns-m11-recompute-all.json` 8.955 mw120 / 9.123 mw50 ungated,
`8cg585-m11-spread.json` 1.961 / 1.928 with the gate and the slicing, and
`.perf-runs/2026-09-19/8cg575-m11-recompute-all.json` **1.396 / 1.177** with
the frustum as well — so the frustum alone takes **−29% at mw120 and −39% at
mw50** off an already-gated, already-sliced kernel. The whole five-vantage
column there reads mw120 1.396, sol 1.478, earth 1.288, mw50 1.177, lg 2.364.
That artifact is the synthetic set and its band is uncorrected, as the
baseline's was (`../../../../scripts/perf/synthetic-catalog/README.md` § The
band double-counts); a run over it never compares to `pins/`.

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

`readAvMag` answers out of a CPU mirror of the buffer, staged by the pointer
events that precede a pick, because WebGPU has no synchronous readback and a
copy issued *by* a pick resolves after the verdict it was meant to decide.
`mirror/README.md` owns it — the staging gate, the two counters, and why a
refill still cycling warms nothing.
