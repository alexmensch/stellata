# Star layer

**The star pipeline**, constructed through
`WebGpuSeam.attachStarLayer` over the shell's scene (never imported from
`stellata.ts` — the import boundary in `../README.md`). It carries the
three depth-honest pipelines of [Early-z](../README.md#early-z--the-star-layers-depth-honest-redesign): D2 glow (no
depth output), D3 core mask (depth-only, member stamp in the vertex
stage), and D4 disc (colour only, no depth output either — [The disc
draw writes no depth](#the-disc-draw-writes-no-depth)) — plus their local-depth-pass mirror variants
([The local mirror](#the-local-mirror)). No pipeline here writes fragment depth, and the
draw count is three, mirror draws included.
Each main draw is indirect at its tier's survivor count
(`compaction/README.md`), over storage tables indexed by star ([Star
tables](#star-tables--every-per-star-field-is-a-storage-read)) — the vertex stage runs over the stars that can draw, not the
catalogue.
The CPU half of that stack — the star frame, the pass identities, the
blend states, the perceptual-disc mirror — is `../../star-pipeline/`.

## Files in this area

```
src/client/webgpu/star/
  compaction/                  The per-frame compute pass that lists each
                               tier's survivors and counts them into the
                               indirect draw arguments — its own README.
  star-tables-pure.ts (+ test) Layout of the static per-star record table
                               (stride, slots, the interleave).
  star-tables.ts (+ test)      StarTables — the star-indexed storage
                               tables every star stage reads (README.md#star-tables--every-per-star-field-is-a-storage-read), and the per-frame forwarding of
                               the shell's attribute writes onto them.
  star-geometry.ts (+ test)    The two quad geometries, corner + index
                               only, each drawn indirect off its tier's
                               args slot.
  star-visibility-tsl.ts       The dust-independent prefilter's four
                               terms, the two bounds re-tested after
                               extinction, and the clock-independent form
                               the A_V cache gates on (README.md#dust-extinction--two-tiers-one-gate).
  star-vertex-tsl.ts           `solveStarTsl`, the per-star solve the
                               compaction kernel and all six vertex
                               stages share, and the vertex stage over
                               it, compile-time specialized per pass
                               (star-pass.ts): suppression set, eclipse
                               fold, and the core mask's member near-pin
                               are the only per-pass differences.
  star-glow-tsl.ts             The D2 material: glow fragment (soft
                               taper, additive) over the shared stage.
  star-disc-tsl.ts             The D4 material: per-channel max blend,
                               no depth write — README.md#the-disc-draw-writes-no-depth.
  star-core-mask-tsl.ts        The D3 material: depth-only, colour
                               writes off, over the shared disc gate;
                               takes the MRT swap for three's pipeline
                               cache (../hdr/README.md#the-gate-becomes-the-output-struct).
  star-emission-tsl.ts         Fragment pieces the passes share: the
                               kernel and the two halves of the disc gate
                               BOTH disc and core mask run, chart mode's
                               ink disc, starEmission()'s inline-operator
                               select, the MRT output struct +
                               single↔struct mode swap (../hdr/README.md).
  star-layer.ts (+ test)       StarLayer: tables + compaction + the three
                               meshes into the scene, the local mirror,
                               the per-frame `update()`, the shell's
                               core-mask gate, the chart blend swap,
                               dispose.
  star-local-mirror-tsl.ts     The local-depth-pass mirror: the three
    (+ test)                   pipelines' local variants over the shared
                               MirrorSlots geometry, reading the tables
                               by `iSourceIdx` (README.md#the-local-mirror).
  star-sources-mock.ts         StarLayerSources over the zero-filled
                               StarPipeline mock, and the fake renderer
                               the layer tests dispatch into.
```

`solveStarTsl` skips its physical-size branch — the `pow`, the divide and
the `atan` — for every star past `uPhysSizeWindowPc`, where no catalog
star can reach a size any consumer of it notices. What the bound has to
satisfy, and the one consumer held to a tolerance rather than an exact
threshold, is [Eliding the physical-size branch](../../star-pipeline/perceptual-disc/README.md#eliding-the-physical-size-branch).

Which per-star field lands where — the static-table fields, the
forwarded four, the one per-vertex attribute — is
`../star-attribute-roster.ts` ([Star tables](#star-tables--every-per-star-field-is-a-storage-read)).

The operator, emission-unit and perceptual-disc mirrors the fragment
composes live one level up (`../tonemap-tsl.ts`, `../emission-tsl.ts`,
`../perceptual-disc-tsl.ts`) — they are layer-agnostic, and the planet
glare takes all three.

## Dust extinction — two tiers, one gate

The vertex stage reddens and dims every survivor of the prefilter, on two
tiers: the per-star A_V cache is one read of
the star's own element of a storage buffer when `uAvPrepassEnabled` is
set, and the full camera→star march otherwise. Both come from
`../extinction/`, which owns the march, the cache and the one behaviour
that is *not* parity (a cold CPU read of the cache). Three properties
belong here rather than there:

- **The read sits behind the prefilter, and that is exact.** A_V ≥ 0, so
  both the cull bound and the taper bound are monotonic in dust: a star
  already fainter than `uCullMag` unextincted cannot become visible
  after extinction. Testing them first is what keeps a buffer read —
  or, on the fallback, the whole march — off the culled population.
  Both bounds are then re-tested on the extincted magnitude, which is
  why each is built as a fresh node rather than reused: a TSL comparison
  reads its variable where the enclosing `If` emits it, so one node
  object in two places would read two different values and only look
  like an accident.
- **The prepass kernel runs the same four terms**, over
  `starCacheVisibleTsl`'s clock-independent magnitude, so the cache
  fills exactly the population this stage can ask about. Both call
  `starVisibilityTsl`; restating either would let the two disagree about
  who is visible, and what a cache additionally owes for that is
  [The cache gate](../extinction/README.md#the-cache-gate).
- **The march runs in ABSOLUTE space** (`iPosition + uWorldOffset`,
  camera likewise) because the dust grid is anchored to Sol, not to the
  renderer's floating local origin.
- **Reddening applies to whichever colour tier won** —
  `iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi` ([Ballesteros 2012](/data/papers/index.md#ballesteros2012)) — over the shared
  `R_V`, exactly as [Colour routing](../../star-pipeline/README.md#colour-routing)
  describes.

## Chart mode

Chart is a full bypass: flat hard-edged ink discs sized linearly by
magnitude under `MultiplyBlending`, non-photometric, no HDR emission
(`../../star-pipeline/README.md`). It is one branch on
`uMonochrome` in the vertex stage and one in each fragment graph, plus
the layer's blend swap. Three things the split is built around:

- **The disc/glow pivot is outside the branch.** `vPhysRatio` decides
  which pass draws a star on both render styles, so each pipeline's
  entry gate (outside the kernel, wrong side of the pivot) runs ahead of
  the chart test and both styles share it. Only the *remaining* gates
  differ: colour clips at the live `uThresholdMag`, chart at the
  instrument's `uLimitMag`, which inherits neither the scene adaptation
  nor the EV trim.
- **`vAaWidth` is the vertex stage's, per quad.** One CSS pixel in vUv
  units, so the ink edge is one pixel wide at any disc size. `fwidth(r)`
  cannot substitute — `length(vUv)`'s screen-space derivative is
  undefined at the quad centre, and small quads came out faint grey
  rather than solid.
- **The core mask still stamps depth in chart mode**, over exactly the
  fragments its disc draw inks — a different gate, the same rule that
  binds the two in colour mode.

Chart's statistic texel is a flat zero rather than a masked flux: the
chain bypasses the HDR seam entirely, and the pipeline's chart bypass
unbinds the target, so every colour material is already in its
single-output mode by the time the branch runs.

## The lit-surface claim is per pass

Both colour passes share one fragment builder
(`finishStarColourMaterial`), so the statistic mask each one claims is an
argument it hands that builder rather than a branch inside it. D4 claims
`step(uCoreThreshold, glow)`, its resolved core; D2 claims a literal zero
at every framing. Why the split is the general rule and not a star-shaped
exception: [The unit](../../hdr/attachments/README.md#the-unit). Both are pinned
by `../../hdr/attachments/statistic-mask.test.ts`.

The MRT emission/statistic write side is here (`finishStarColourMaterial`,
`StarLayer.setMrtOutputs`) but engages only while the HDR pipeline binds
its target; single-output frames run the inline operator, which is exact
for point sources ([The inline operator](../../hdr/README.md#the-inline-operator--chart-modes-path)). All three
pipelines swap, the depth-only core mask included — its writes are
masked, but an unchanged fragment program is handed the stale
three-target pipeline from three's cache when the target drops to one
attachment ([The gate becomes the output struct](../hdr/README.md#the-gate-becomes-the-output-struct)).

## Star tables — every per-star field is a storage read

The geometry carries the quad corner and nothing per instance: the
instance index names a slot in a survivor list (`compaction/README.md`),
not a star, so every per-star field is a storage-buffer read at the
resolved star index — `tables.stat(self, field)` for the static record,
`tables.position(self)` and `tables.scalar(name, self)` for the live
ones, `av.element(self)` for extinction. The mirror reads the same tables
at its `iSourceIdx`. Two kinds of table:

- **The static record table** — the nine load-time scalars plus the two
  pulsation components, interleaved once at construction into one float
  table of `STAR_STATIC_STRIDE` (12) floats per star, roster order, pad
  slot zero. The stride rounds the roster's eleven fields up to whole
  vec4s for headroom, not for alignment — scalar reads out of a float
  table need none — so a twelfth static field costs no bytes and a
  thirteenth takes the stride to 16, costing a whole vec4 rather than a
  slot: 16 B per star, 5.9 MiB at today's count. Built from the
  catalogue and star-frame arrays; never written again.
- **The forwarded tables** — `iPosition`, `iCompositeSuppress`,
  `iEclipseDim`, `iSuppressPulsation`. The shell builds them through
  `../../star-pipeline/star-source-attributes.ts` as plain
  `BufferAttribute`s over its **own live arrays** — nothing instances
  them and no geometry holds them; they carry the version and dirty
  ranges every writer (BinaryOrbitField, EclipsePhotometryField,
  StarFrame's recentre, the shell's re-attach inits) flags. Each forwarded table is a
  `StorageBufferAttribute` **over that attribute's own `Float32Array`**,
  itemSize 1 — no copy, so there is nothing to keep current — and
  `StarTables.syncSources()` forwards the source's `version` and
  `updateRanges` onto it **verbatim**: same array, same element units.
  The position table is `count × 3` floats read as three scalars, never
  an itemSize-3 storage attribute ([Why no table is itemSize 3](#why-no-table-is-itemsize-3)).

### What a dirty frame costs, and which writer decides

Two paths, picked by whether the writer reported three.js update ranges:

- **Ranged** — the writer named the slots it touched
  (`BinaryOrbitField`'s `DirtyItemUploader`, [attribute-upload](/src/client/util/README.md#attribute-uploadts)).
  The forwarded ranges upload those bytes and no
  others, so a sub-pixel binary flip costs a handful of floats. The layer
  also **clears the source's range list** — no geometry draws the source
  attribute itself, so they would otherwise accumulate to
  `MAX_PARTIAL_RANGES` and collapse into a full upload.
- **Whole-buffer** — a bare `needsUpdate`, which is what the shell's
  re-attach inits and a recentre set (through `uploadFull`, so a pending
  range list cannot outrank the full array). Costs the table's whole
  `writeBuffer`: 4.4 MiB for positions, 1.5 MiB per scalar table. A range
  forwarded behind an unconsumed full upload is dropped, since three
  honours a non-empty range list INSTEAD of the full array; `endFrame()`
  after the dispatch is what re-arms ranged forwarding.

**None of the tables carries `DynamicDrawUsage`, on purpose.** three's
WebGPU backend re-runs `updateAttribute` on every render call for any
attribute with that usage, and with no pending ranges that is the whole
buffer — 4.4 MiB every rendered frame for the position table with the
hint set. A table upload happens when its version moves and not otherwise.

`EclipsePhotometryField` forces its own first writing flush full,
because the shell's re-attach fill reaches stars outside the member
slots it tracks ([Partial re-upload](../../binaries/eclipse/README.md#partial-re-upload))
— a range list appended before a render consumed that fill
would strand every untracked star at the previous attach's value.

### What the tables hold

Byte counts, derived not measured — `recordCount`
(`scripts/catalog/build-catalog-expected.json`) × element size, moving
with the catalogue. `debug.memory()` cannot price them
(they bind through TSL nodes, `../../debug/memory/README.md`), which is
why the arithmetic is stated:

| Resident | Size |
| --- | --- |
| Static record table (12 × f32 per star) | 388,071 × 48 B ≈ 17.8 MiB |
| Position table (3 × f32 per star) | 388,071 × 12 B ≈ 4.4 MiB |
| Three scalar tables (f32 per star each) | 3 × 1.5 MiB ≈ 4.4 MiB |

The static table's `Float32Array` stays on the JS heap after upload
(three does not release it); the forwarded tables add none — their
arrays are the shell's.

### Why no table is itemSize 3

WGSL has no packed `vec3` in a storage buffer, so for an itemSize-3
storage attribute three pads to 4 and **reassigns the attribute's
`itemSize` and `array` to the padded copy** on first upload. Anything
holding the originals — `DirtyItemUploader`, which caches both at
construction — then diffs a stride and an array the GPU never sees, and
emits ranges addressing the unpadded layout. Reading positions as three
scalars out of an itemSize-1 table over the writer's own array is what
keeps [Partial re-upload](../../binaries/README.md#partial-re-upload)'s contract on the
source attribute intact without that attribute ever becoming storage.

## Suppression semantics carried by the pass specialization

Compile-time pass constants decide what each pipeline suppresses
(star-vertex-tsl.ts):

- **Glow (D2)**: the hidden focal star and local-pass members collapse to
  the clip sentinel; eclipse totality collapses; a partial `iEclipseDim`
  folds into `appMag` before any size/brightness derivation — but **not**
  before the pass split, which every pipeline solves from the undimmed
  `appSize` or the three would tier the same star differently and all
  discard it ([Star rendering](../../star-pipeline/README.md#star-rendering-instanced-quads-three-passes)). Every
  pipeline carries `routeAppSize`; only this one can diverge from
  `appSize`, and only behind a runtime test on the dim, so an undimmed
  star never pays the re-solve. The undimmed magnitude it re-solves from
  (`appMagRoute`) is carried from before the fold rather than recovered
  by subtracting the dim back off — that subtraction does not round-trip
  in float32, and the carried value is bit-equal to what D3/D4 derive.
  `iCompositeSuppress` never gates glow (the summed pair is the point).
- **Disc (D4, both draws)**: focal hide, members, and
  `iCompositeSuppress` collapse; `iEclipseDim` is ignored — a resolved
  pair's occlusion orders geometrically in the local depth pass.
- **Core mask (D3)**: focal hide and `iCompositeSuppress` collapse;
  **members keep their draw** — the stamp is what stops main-pass
  background painting inside the core the local pass repaints. The member
  stamp is in the vertex stage: the member quad's clip z pins to the near end of the reversed-z
  convention (`z = +w`, `CORE_MASK_NEAR_PIN_EPS` inside the bound), so
  fixed-function depth writes the nearest value and early-z survives.

`uPinFocusToCenter` substitutes the canonical projection. Every pass also carries the taper cull — off entirely in
chart mode, which sizes and clips against `uLimitMag` and keeps its
quads — and the colour passes carry the kernel collapse; the exactness
and flux-preservation arguments are
`../../star-pipeline/collapse/README.md`'s.

## The local mirror

`star-local-mirror-tsl.ts` sits behind the `StarMirror` interface, which
`StarLocalCluster` drives. Its shape:

- **The slots carry `iSourceIdx` alone.** The slot geometry, the copy and
  the three draws are the shared `MirrorSlots`
  (`../../star-pipeline/local-pass/star-mirror-slots.ts`), which mirrors
  every instanced attribute of the source geometry by name — and this
  layer's geometry has none, so the copy degenerates to the member
  indices. Every star field the mirror's vertex stage reads comes out of
  the layer's tables at that index ([Star tables](#star-tables--every-per-star-field-is-a-storage-read)), the same reads the
  main passes make at a survivor-list index, so the two cannot resolve
  a field differently. Two vertex buffers, no indirect draw: the mirror
  draws `instanceCount = members`, its survivor set being the CPU member
  list.
- **`sync()` copies nothing but the member indices**, so it forwards
  nothing either: the tables it reads are made current by
  `StarLayer.update(camera)`, which runs past the render gate between the
  frame's uniform sync and its render, while the local depth pass draws
  later in that same tick. A member slot and the table it indexes are
  therefore the same frame's whatever order the cluster updates in.
- **The vertex stage is the shared builder's `mirror` source variant**:
  star identity comes from `iSourceIdx` (hide/pin compares match the
  source instance), member collapse is off — the mirror draws exactly
  the members — and the core mask writes true bracket depth instead of
  the main variant's near pin.
- **The mirror's colour draws ride `StarLayer.setMrtOutputs`** — they
  land in the same HDR target as the main passes, so the single↔struct
  swap covers all four colour materials at once.

In-pass renderOrders: mask −1 → disc 0 → glow 3.5
(after the body surfaces, before the planet glare at 4).

## The disc draw writes no depth

A disc pass that wrote a far-plane depth under its halo fragments, so
later glow could peek through the haze, would cost the whole pipeline its
early rejection of hidden fragments with that one conditional write.
Writing **no** depth from this draw buys the same thing more directly: the halo leaves the buffer alone, so background
glow accumulates over it exactly as before, and a mesh behind the star
no longer punches a hole in the annulus through the depth test either.

**The core mask is where a core's depth comes from.** D3 draws at
renderOrder −4 over the *same* gate this draw runs — same three tests,
same kernel, one helper (`star-emission-tsl.ts` `discPassKernel`) — and
stamps every fragment with `glow ≥ uCoreThreshold`. That is exactly the
set a disc pass would write fixed-function depth for, at exactly the
same value, several renderOrders earlier. So a depth write here would
be a second write of a value already in the buffer:

- Background layers draw **after** −4 and **before** 0, so only the
  mask can ever occlude them — the disc's write never could.
- The glow pass (renderOrder 1) tests against the mask's stamp.
- Two overlapping resolved discs: the nearer core's stamp rejects the
  farther one's fragments, as before. A core passes its own stamp
  because `LessEqualDepth` maps to greater-or-equal under reversed z.

Splitting the draw in two — a depth-writing core plus a depthWrite-off
halo — also works, but doubles this pass's per-corner cost: a second full
390k-instance draw running the whole distance / magnitude / pulsation /
colour-lookup chain to re-derive varyings the first draw already had.
Three draws is the count.

**In the local pass the same split holds with one caveat.** The mirror's
disc draw writes no depth either — its own mask (in-pass renderOrder −1)
stamps every member core's true bracket depth first, so the redundancy
argument carries over. The one consequence: a nearer member's halo
cannot reopen depth over a farther member's stamped core, so that stamp
survives. The recorded fallback if close-pair smoke rejects the
difference is the viewport depth-range pin — bit-exact, at the price of
a per-draw viewport state change.

**What this gives up, and where.** The mask's `visible` gate is off
when no star's disc can reach `RESOLVED_DISC_MIN_PX` (5 px) —
[Star rendering](../../star-pipeline/README.md#star-rendering-instanced-quads-three-passes). A disc *can* render
below that (the pass split has no pixel floor, only
`physSize ≥ 0.5 · max(appSize, physSize)` on the **undimmed** `appSize`
— not on `pxSize`, which an eclipse dim shrinks without re-tiering the
star), and in that band a core now takes no part
in depth in either direction: nothing behind it is occluded by it.
That band is already the one where the same gate accepts the whole
Milky Way band, the molecular clouds and the galactic grid painting
*through* a core, on the stated grounds that a sub-5 px artefact is
too small to see. The light this adds is one background point source's
glow over a core that is 5 px or smaller — strictly less than what the
gate already lets through, in the same band, on the same argument.
Above 5 px, from any vantage and at any epoch, ordering is unchanged.

Recorded fallbacks if smoke rejects that band. Cheapest: re-split the
draw (git history carries it) and pay the second per-corner pass. Exact
and nearly free, but it moves a shared gate: widen the mask's window
from `RESOLVED_DISC_MIN_PX` to the disc pass's own floor,
`0.5 · uSizeMin`, so the mask is on wherever a disc draws at all — that
makes the redundancy above total rather than conditional, at the cost of
a mask draw over a wider camera-distance band, and of a gate that keys
on a debug slider.
