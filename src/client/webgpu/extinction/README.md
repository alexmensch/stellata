# Per-star dust extinction on WebGPU

The TSL twin of `../../star-pipeline/extinction/`: the camera→star
Edenhofer raymarch as a **compute kernel**, and the per-star A_V buffer
the star vertex stage indexes instead of re-marching. What the read
*means* — the two-tier colour routing it reddens, the 48-tap calibration,
and above all the **cancellation invariant** (catalog `absmag`/`ci` are
stored de-extincted, so this stack restores extinction rather than adding
it twice) — is not re-decided here; that README owns it and a change to
either march has to ship with the mirrored build-side integral.

## Files in this area

```
src/client/webgpu/extinction/
  dust-raymarch-tsl.ts        TSL mirror of the stellata_dust_raymarch
                              chunk, over dust-raymarch-pure's DUST_STEPS.
                              Shared by the kernel, the parity reference
                              and the star vertex fallback exactly as the
                              GLSL chunk is.
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
  buffer, and its position is element *i* of a `count`-long vec4 buffer.
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

`compute(count)` over one `Fn`: thread *i* reads position *i* out of a
read-only vec4 storage buffer, marches from `absCameraPos` to it with the
shared `dustRaymarchAvTsl`, and assigns the result to element *i* of the
A_V buffer. three's default workgroup of 64 and its own early return for
the threads past `count` in the last group; neither buffer is touched out
of range. `update()` is one `renderer.compute(kernel)` — its own submit,
exactly as the fragment pass was its own render (`docs/render-rules.md`
§ 8), and it binds no render target, so the ends-at-the-canvas contract
the fragment twin kept has nothing here to hold. Pinned as
"never touches the render-target binding".

**Positions are vec4, not vec3, deliberately.** WGSL has no packed vec3
in a storage buffer, and an itemSize-3 storage attribute is the one
three silently re-strides (`../README.md` § One writer per buffer per
submit). Both buffers are owned outright by the prepass — allocated,
filled once, released through `disposeStorageAttribute` — and neither is
a vertex attribute anyone uploads through `DirtyItemUploader`, so
`iPosition` and the binaries partial-upload contract are untouched.

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
first offender and the largest gap. The target exists for the call only.
Run it at Sol default and on a Galactic-centre sightline (the bead's
smoke views); a nonzero count there is a finding about the two stages'
compilation, not a tolerance to widen.

### What this stage discharges of the buffer-writer requirements

Of the four requirements the single-writer audit put on this design
(bead `stellata-0it.15`, design field):

- **Per-draw addressing (1)** is met without slots. The A_V buffer is
  written once per recompute by one dispatch, ahead of the frame's render
  submit, and every star draw in that submit — three main passes and
  their local-mirror clones — wants the *same* bytes. The slotting rule
  starts owing the moment a buffer carries a value that differs between
  draws sharing a submit, which is the compacted instance lists and the
  indirect args of the next stage, not this one.
- **The itemSize-3 uploader trap (4)** is avoided by construction: the
  position table is vec4 and the A_V table is float, both owned outright,
  and no itemSize-3 attribute moved. It bites again when `iPosition`
  itself moves to storage; `../../binaries/README.md` § Partial re-upload
  stays the current contract until then.
- **The prefix-sum router (2)** and **survivor-sized bind groups (3)** are
  compaction's, not this stage's.

## What it costs, and what it holds

Both figures below are the WebGL2 pass's unchanged in size — the port
moved the work to a compute stage and allocated nothing new. **Re-derive
rather than trust them**: they are `recordCount` (388,071 —
`../../../../scripts/catalog/build-catalog-expected.json`) × the element
size, and both move with the catalog. `debug.memory()` prices the live
app (`../../debug/memory/README.md`), and on a WebGL2 boot it *measures*
the A_V target rather than taking this table's word.

| Resident | Size |
| --- | --- |
| A_V buffer (one float32 per star) | 388,071 × 4 B ≈ 1.48 MiB |
| Position buffer (one vec4 float32 per star) | 388,071 × 16 B ≈ 5.92 MiB |

So ~7.4 MiB of video memory for the pass's whole life, plus the ~5.9 MiB
`Float32Array` the position attribute keeps on the JS heap after upload
(three does not release it, and the WebGL2 twin's `DataTexture` holds the
same). Both survive on an integrated or mobile GPU without argument.

**What does not survive everywhere is the vertex stage's right to read the
buffer at all.** The WebGL2 layout's floor was `maxTextureDimension2D`,
which 1024 clears on every device; a storage buffer read from a vertex
stage answers to `maxStorageBuffersInVertexStage` instead, and that is
**zero** at WebGPU's compatibility feature level. So the floor this cache
sets is no longer free, and it is no longer this folder's to keep: the
boot refuses such a device outright (`../tsl/README.md` § Storage
attributes), which is what makes `supported` constant true here honest
rather than merely untested.

**A recompute is ~18.6M volume samples**: one thread per star × 48
taps, 388,071 × 48. That is the whole per-recompute cost and it is paid
*per frame* while the camera keeps moving more than
`RECOMPUTE_EPSILON_PC` between frames — a warp pays it every frame, which
is the case to measure, not the idle one. An idle camera costs zero, and
the visibility prefilter never applies here: the kernel marches every
star, because the pass has no per-star magnitude to gate on.

**On a WebGPU boot `debug.memory()` cannot price either row.** Both bind
through TSL nodes rather than a `uniforms` slot, so the walk reaches
neither and the star materials surface as `unknown`-basis rows instead —
flagged, not silently dropped. Until `8cg.42` changes that, this table is
the authority on that backend, which is the reason it states the
arithmetic and not just the totals.

## Cold reads — the one behaviour that is not parity

`readAvMag(idx)` is synchronous on WebGL (`gl.readPixels`, memoised) and
the pick paths call it that way: a star's extinction decides whether the
renderer put a pixel on screen for it, so a pick gated on the intrinsic
magnitude selects stars the frame drew black.

WebGPU has **no synchronous readback** — `getArrayBufferAsync` stages a
4-byte `copyBufferToBuffer` at the star's offset and maps it, resolving
frames later. So this implementation answers a **cold** index with `null`
and warms the memo in the background; the next read is exact and free.
`null` already means "no cache, not no dust" to every caller
(`../../star-pipeline/extinction/README.md` § Reading A_V back), and
those callers err toward *pickable*, so a star behind heavy dust can be
picked where WebGL2 would have rejected it.

**How long that lasts is set by the pick's cadence, not by the frame's.**
Two things make it outlive the readback:

- Hover resolves on `pointermove` alone (`../../hover/hover-engine.ts`) —
  nothing re-runs a pick per frame. The memo warms a frame or two later,
  but the standing verdict is not revisited, so a **still cursor keeps
  the wrong star** until the pointer moves again.
- `pickFromCandidatesResolved` returns on the first candidate that reads
  visible (`../../camera/controls/star-geometry.ts`), so one event warms
  exactly one candidate. Down a sightline where several extincted stars
  overlap, convergence takes one pointer event per candidate.

Neither is a frame-scale effect, and the honest statement of the
degradation is that scale: an event, not a frame. It is accepted here
because chart and colour picking both already err toward pickable and
because the pick-path stage of `0it.15` replaces this read wholesale —
the buffer is now one mapped copy away from a whole-catalogue memo, which
is what makes that closure a readback design rather than a per-star
patch.

Why not the alternatives: reading the whole buffer on each recompute is
1.5 MB per read and a warp recomputes every frame; marching on the CPU
needs the ~128 MiB voxel grid the loader uploads and drops, and would be
a second implementation of the integral free to drift from the shader's.
The lazy per-star read keeps the existing contract — event-rate only,
never swept over the catalog.

Two guards make the async path safe. An index already in flight is not
re-requested, so a `pointermove` sweep re-asking every frame costs one
copy rather than one per frame. And every recompute bumps a
**generation** counter: a read that resolves against the previous
buffer's contents is dropped rather than memoised, which is the same
invalidation rule as the WebGL twin's `avCache.clear()`, expressed for a
promise that can outlive the thing it was reading.
