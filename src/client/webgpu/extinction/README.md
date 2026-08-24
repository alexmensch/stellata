# Per-star dust extinction on WebGPU

The TSL twin of `../../star-pipeline/extinction/`: the camera→star
Edenhofer raymarch, and the per-star A_V cache the star vertex stage
fetches instead of re-marching. What the read *means* — the two-tier
colour routing it reddens, the 48-tap calibration, and above all the
**cancellation invariant** (catalog `absmag`/`ci` are stored
de-extincted, so this stack restores extinction rather than adding it
twice) — is not re-decided here; that README owns it and a change to
either march has to ship with the mirrored build-side integral.

## Files in this area

```
src/client/webgpu/extinction/
  dust-raymarch-tsl.ts        TSL mirror of the stellata_dust_raymarch
                              chunk, over dust-raymarch-pure's DUST_STEPS.
                              Shared by the prepass and the star vertex
                              fallback exactly as the GLSL chunk is.
  extinction-texture-nodes.ts The two texture slots as nodes, with their
    (+ test)                  placeholders and the attach-time swap
                              (§ Two nodes, one owner).
  extinction-prepass-webgpu.ts  WebGpuExtinctionPrepass — the fullscreen
    (+ test)                  march into a star-indexed R32Float target,
                              behind ExtinctionPrepassSeam.
```

## What the port did NOT re-express

- **No `EXT_color_buffer_float` verdict.** Float render targets are core
  WebGPU, so `supported` is constant true and there is no
  fallback-because-the-hardware-cannot branch to port. The *A/B* fallback
  survives — `setExtinctionPrepassEnabled(false)` still parks the vertex
  stage on its in-vertex march, which is what makes the prepass win
  measurable on identical scenes.
- **No `gl.readPixels`.** § Cold reads.

Everything else is mechanical: the same algorithm, the same
`AV_TEX_WIDTH` × `⌈count/1024⌉` star-indexed layout (star *i* at texel
`(i % 1024, i / 1024)`), the same `packPositionsRgba` packing, and the
same `RECOMPUTE_EPSILON_PC` displacement gate — so the consumer's index
arithmetic and the mirror draws' `iSourceIdx` indirection are untouched,
and an idle camera still costs zero.

## Two nodes, one owner

`ExtinctionTextureNodes` holds both texture slots for the whole boot and
`boot-webgpu.ts` constructs exactly one. That single ownership is
load-bearing in both directions:

- **The dust volume is sampled from two places** — the prepass march and
  the star vertex stage's fallback march. They share the node by object
  identity, so the shell's one `attachDust` reaches both. Two nodes would
  give a bug whose symptom is that the A/B toggle changes the picture:
  one branch sampling dust, the other an empty placeholder.
- **The A_V slot is written by the pass, not by the shell.** The prepass
  points it at its own target in its constructor and back to the
  placeholder on dispose. The shell holds only the seam handle.

The pair is **boot-scoped**, and `WebGpuSeam.dispose()` is the only path
that frees it — the shell calls that after every layer and the prepass,
because those hand their slots back to these placeholders on the way out.
Any future boot-scoped allocation in `boot-webgpu.ts` belongs on the same
path; nothing else reaches it.

Both slots bind over a **1-texel placeholder** whose `.value` is swapped
when the real texture arrives, because a uniform node cannot carry a
nullable texture (`../README.md` § Shared uniform nodes). The
placeholders match their targets' format and type exactly — the volume's
comes from `createVoxelTexture`, the same factory the staging copies use
— so a swap rebinds rather than rebuilding the pipeline. Neither slot is
read while its `uDustEnabled` / `uAvPrepassEnabled` scalar is 0, so
placeholder contents never reach a pixel.

`uAvPrepassTex` in the shared map therefore stays null for a WebGPU
boot's whole life. It is a texture slot, and the node mirror carries
none.

## What it costs, and what it holds

Both figures below are the WebGL2 pass's unchanged — the port moved no
work and allocated nothing new, which is the claim worth having written
down rather than re-derived. At the 313k-star catalog, `avTexHeight`
gives 306 rows:

| Resident | Size |
| --- | --- |
| A_V target (`RedFormat` + `FloatType`, 4 B/texel) | 1024 × 306 × 4 B ≈ 1.25 MB |
| Position texture (`RGBAFormat` + `FloatType`, 16 B/texel) | 1024 × 306 × 16 B ≈ 5.0 MB |

So ~6.3 MB of video memory for the pass's whole life, plus the ~5 MB
`Float32Array` the position `DataTexture` keeps on the JS heap after
upload (three does not release it, and the WebGL2 twin holds the same).
Both survive on an integrated or mobile GPU without argument, and 1024 is
inside every `maxTextureDimension2D` — the layout's width was chosen for
that.

**A recompute is ~15M volume samples**: one fragment per star × 48 taps,
313k × 48. That is the whole per-recompute cost and it is paid *per
frame* while the camera keeps moving more than `RECOMPUTE_EPSILON_PC`
between frames — a warp pays it every frame, which is the case to
measure, not the idle one. An idle camera costs zero, and the visibility
prefilter never applies here: the prepass marches the full catalog
including the ≤1023 padding texels, because the pass has no per-star
magnitude to gate on. Unmeasured on this backend — no `gpu.frame`
differential has been taken for it yet, so treat the parity claim as
structural (same algorithm, same tap count, same layout) rather than
timed.

## Cold reads — the one behaviour that is not parity

`readAvMag(idx)` is synchronous on WebGL (`gl.readPixels`, memoised) and
the pick paths call it that way: a star's extinction decides whether the
renderer put a pixel on screen for it, so a pick gated on the intrinsic
magnitude selects stars the frame drew black.

WebGPU has **no synchronous readback** — `readRenderTargetPixelsAsync`
stages a `copyTextureToBuffer` and maps it, resolving frames later. So
this implementation answers a **cold** index with `null` and warms the
memo in the background; the next read is exact and free. `null` already
means "no cache, not no dust" to every caller
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
because `0it.15` replaces the readback wholesale — its scope carries the
closure explicitly, so the hole is not resting on this paragraph alone.

Why not the alternatives: reading the whole target on each recompute is
1.25 MB per read and a warp recomputes every frame; marching on the CPU
needs the ~128 MiB voxel grid the loader uploads and drops, and would be
a second implementation of the integral free to drift from the shader's.
The lazy per-star read keeps the existing contract — event-rate only,
never swept over the catalog — and the compute rewrite (`0it.15`)
restructures this surface anyway.

Two guards make the async path safe. An index already in flight is not
re-requested, so a `pointermove` sweep re-asking every frame costs one
copy rather than one per frame. And every recompute bumps a
**generation** counter: a read that resolves against the previous
target's contents is dropped rather than memoised, which is the same
invalidation rule as the WebGL twin's `avCache.clear()`, expressed for a
promise that can outlive the thing it was reading.

## The prepass draw

One `QuadMesh` over a `NodeMaterial` whose fragment is the whole pass:
the position texture's texel at this fragment's own `screenCoordinate`
IS the star, so there is no vertex work and no geometry of its own. The
fragment returns a `vec4` whose extra components the single-channel
target drops.

The target is `RedFormat` + `FloatType` (r32float): renderable, not
blendable — `NoBlending` — and sampled without a filtering sampler,
which the consumer's `textureLoad` satisfies by construction. Both the
target and its placeholder are `NearestFilter`, which is what makes three
emit no `sampler` binding at all; an r32float bound to a filtering
sampler fails pipeline creation outright.

`update()` ends by binding the **canvas**, not by restoring whatever was
bound on entry — the same contract `../hdr/reduction-webgpu.ts` keeps and
pins, so no pass on this backend may run inside another's binding. The
WebGL2 twin save/restores instead, so this is a deliberate divergence
rather than a dropped defence, and it is pinned on both sides.
