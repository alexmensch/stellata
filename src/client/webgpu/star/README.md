# Star layer on WebGPU

The TSL star pipeline behind `#renderer=webgpu`, constructed through
`WebGpuSeam.attachStarLayer` (never imported from `stellata.ts` — the
import boundary in `../README.md`). It carries the three depth-honest
pipelines of `../README.md` § Early-z: D2 glow (no depth output), D3
core mask (depth-only, member stamp in the vertex stage), and D4 disc
(colour only, no depth output either — § The disc draw writes no
depth) — plus their local-depth-pass mirror variants (§ The local
mirror). No pipeline here writes fragment depth, and the draw count
matches the WebGL2 stack one for one, mirror draws included. The WebGL2 pipeline
(`../../star-pipeline/`) stays the shipped renderer and the semantic
reference; parity is verified by the A/B smoke, same `/v/<blob>/` with
and without the fragment.

## Files in this area

```
src/client/webgpu/star/
  star-geometry.ts (+ test)    Packed instanced geometry: aCorner,
                               iPosition + iPuls (both shared by object
                               identity), iPack0-2, iDyn0 — 7 of the 8
                               vertex buffers (../tsl/README.md
                               § Attribute packing).
  star-vertex-tsl.ts           The shared vertex stage, compile-time
                               specialized per pass (star-pass.ts):
                               suppression set, eclipse fold, and the
                               core mask's member near-pin are the only
                               per-pass differences.
  star-glow-tsl.ts             The D2 material: glow fragment (soft
                               taper, additive) over the shared stage.
  star-disc-tsl.ts             The D4 material: per-channel max blend,
                               no depth write — § The disc draw writes
                               no depth.
  star-core-mask-tsl.ts        The D3 material: depth-only, colour
                               writes off, over the shared disc gate.
  star-emission-tsl.ts         Fragment pieces the passes share: the
                               kernel and the two halves of the disc gate
                               BOTH disc and core mask run, chart mode's
                               ink disc, starEmission()'s inline-operator
                               select, the MRT output struct +
                               single↔struct mode swap (../hdr/README.md).
  star-layer.ts (+ test)       StarLayer: geometry + the three meshes into
                               the seam's scene, the local mirror, the
                               per-frame dynamic re-pack, the shell's
                               core-mask gate, the chart blend swap,
                               dispose.
  star-local-mirror-tsl.ts     The local-depth-pass mirror: the three
    (+ test)                   pipelines' local variants over the shared
                               MirrorSlots copy of the packed geometry
                               (§ The local mirror).
  star-sources-mock.ts         StarGeometrySources over the zero-filled
                               StarPipeline mock, for tests.
```

The operator, emission-unit and perceptual-disc mirrors the fragment
composes live one level up (`../tonemap-tsl.ts`, `../emission-tsl.ts`,
`../perceptual-disc-tsl.ts`) — they are layer-agnostic, and the planet
glare already takes all three, exactly as it takes the GLSL chunks.

## Dust extinction — two tiers, one gate

The vertex stage reddens and dims every survivor of the prefilter, on the
same two-tier shape the GLSL has: the per-star A_V cache is one
`textureLoad` of the star's own texel when `uAvPrepassEnabled` is set,
and the full 48-tap camera→star march otherwise. Both come from
`../extinction/`, which owns the march, the cache and the one behaviour
that is *not* parity (a cold CPU read of the cache). Three properties
belong here rather than there:

- **The read sits behind the prefilter, and that is exact.** A_V ≥ 0, so
  both the cull bound and the taper bound are monotonic in dust: a star
  already fainter than `uCullMag` unextincted cannot become visible
  after extinction. Testing them first is what keeps a `textureLoad` —
  or, on the fallback, the whole march — off the culled population.
  Both bounds are then re-tested on the extincted magnitude, which is
  why each is built as a fresh node rather than reused: a TSL comparison
  reads its variable where the enclosing `If` emits it, so one node
  object in two places would read two different values and only look
  like an accident.
- **The march runs in ABSOLUTE space** (`iPosition + uWorldOffset`,
  camera likewise) because the dust grid is anchored to Sol, not to the
  renderer's floating local origin.
- **Reddening applies to whichever colour tier won** —
  `iTeffApsis > 0 ? Ballesteros(iTeffApsis) : iCi` — over the shared
  `R_V`, exactly as `../../star-pipeline/README.md` § Colour routing
  describes.

## Chart mode

Chart is a full bypass: flat hard-edged ink discs sized linearly by
magnitude under `MultiplyBlending`, non-photometric, no HDR emission
(`../../star-pipeline/README.md`). On this backend it is one branch on
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

The MRT emission/statistic write side is here (`starMrtStruct`,
`setMrtOutputs`) but engages only while the HDR pipeline binds its
target; single-output frames run the inline operator, which is exact
for point sources (`../../hdr/README.md` § Fallback).

## Dynamic attributes — who uploads what

The shell constructs the WebGL `StarPipeline` on every boot; on a WebGPU
boot its meshes never render, but its **attributes are the live source
buffers** every writer (BinaryOrbitField, EclipsePhotometryField,
StarFrame's recentre, the shell's re-attach inits) keeps writing. This
layer taps them without any writer learning about the port:

- **iPosition and iPuls** join this geometry **by object identity** — the
  same `InstancedBufferAttribute` objects, so neither pays a second copy
  and iPosition's `needsUpdate` flip reaches whichever renderer draws it.
  (iPuls is static; it shares for the memory, not the writes.)
- **The three per-frame scalars** (`iCompositeSuppress`, `iEclipseDim`,
  `iSuppressPulsation`) interleave into the packed `iDyn0` vec4, so they
  cannot share the object. `StarLayer` version-watches each source
  attribute from the glow mesh's `onBeforeRender` and re-packs the
  changed component; watcher sentinels start at -1 so the first rendered
  frame always packs.

### What a dirty frame costs, and which writer decides

Two paths, picked by whether the writer reported three.js update ranges:

- **Ranged** — the writer named the slots it touched
  (`BinaryOrbitField`'s `DirtyItemUploader`, `util/README.md`
  § attribute-upload). The layer re-packs those items only and adds the
  matching `iDyn0` element ranges, so a sub-pixel binary flip costs a
  handful of floats. The layer also **clears the source's range list** —
  on a WebGPU boot the WebGL geometry never renders, so no renderer
  consumes them and they would otherwise accumulate to
  `MAX_PARTIAL_RANGES` and collapse into a full upload.
- **Whole-buffer** — a bare `needsUpdate`, which is what
  `EclipsePhotometryField` and the shell's re-attach inits set. Costs a
  330k-iteration re-pack on the CPU plus a **5.3 MB** `writeBuffer`
  (330k × vec4 × 4 B), against 1.3 MB for the WebGL scalar it replaces.
  During an active eclipse that is **every frame**: ~320 MB/s of upload
  traffic at 60 Hz, which on a low-end integrated or mobile GPU sharing
  system memory with the display is the kind of figure that shows up in
  the frame time. Ranges would remove it — `EclipsePhotometryField`
  already knows which slots it touched — and that is `stellata-apkh`,
  which improves the WebGL path in the same move.

Neither figure is measured; both are byte counts, not `gpu.frame`
differentials. Pricing the eclipse frame belongs to the perf program
(`stellata-8cg`). `instance_index`-indexed storage buffers supersede
packing entirely after the compute prepass.

## Suppression semantics carried by the pass specialization

Compile-time pass constants replace the `uRenderMode` branches
(star-vertex-tsl.ts):

- **Glow (D2)**: the hidden focal star and local-pass members collapse to
  the clip sentinel; eclipse totality collapses; a partial `iEclipseDim`
  folds into `appMag` before any size/brightness derivation — but **not**
  before the pass split, which every pipeline solves from the undimmed
  `appSize` (`routeAppSize`, built here only) or the three would tier the
  same star differently and all discard it
  (`../../star-pipeline/README.md` § Star rendering);
  `iCompositeSuppress` never gates glow (the summed pair is the point).
- **Disc (D4, both draws)**: focal hide, members, and
  `iCompositeSuppress` collapse; `iEclipseDim` is ignored — a resolved
  pair's occlusion orders geometrically in the local depth pass.
- **Core mask (D3)**: focal hide and `iCompositeSuppress` collapse;
  **members keep their draw** — the stamp is what stops main-pass
  background painting inside the core the local pass repaints. The GLSL
  build's `gl_FragDepth = 0.0` member stamp moves to the vertex stage:
  the member quad's clip z pins to the near end of the reversed-z
  convention (`z = +w`, `CORE_MASK_NEAR_PIN_EPS` inside the bound), so
  fixed-function depth writes the nearest value and early-z survives.

`uPinFocusToCenter` substitutes the canonical projection exactly as the
GLSL does. Every pass also carries the taper cull — off entirely in
chart mode, which sizes and clips against `uLimitMag` and keeps its
quads, and the colour passes
the kernel collapse — the exactness and flux-preservation arguments are
`../../star-pipeline/collapse/README.md`'s, one mechanism on both
backends.

## The local mirror

`star-local-mirror-tsl.ts` is the GLSL `StarLocalMirror`'s twin behind
the shared `StarMirror` interface: `StarLocalCluster` drives whichever
one the boot built, and never learns which. What the port changes:

- **The copy is of packed buffers.** The slot geometry, the copy and the
  three draws are the shared `MirrorSlots`
  (`../../star-pipeline/local-pass/star-mirror-slots.ts`) — every
  instanced attribute of the layer's geometry (`iPosition`, `iPuls`, the
  `iPack`/`iDyn` vec4s) mirrored by name into MIRROR_CAPACITY slots, so
  the `packedScalar` accessors resolve to the same buffer component on
  both geometries by construction — the mismatch that would otherwise
  read as a silent brightness bug. With `iSourceIdx` that is exactly the
  8-buffer budget.
- **`sync()` re-packs before it copies.** The cluster updates before the
  frame renders, i.e. before any main mesh's `onBeforeRender` re-pack —
  so the mirror hands the layer's dynamic re-pack to `MirrorSlots.sync`
  as its pre-copy hook, or an eclipse dim would reach the mirror one
  frame late.
- **The vertex stage is the shared builder's `localMirror` variant**:
  star identity comes from `iSourceIdx` (hide/pin compares match the
  source instance), member collapse is off — the mirror draws exactly
  the members — and the core mask writes true bracket depth instead of
  the main variant's near pin.
- **The mirror's colour draws ride `StarLayer.setMrtOutputs`** — they
  land in the same HDR target as the main passes, so the single↔struct
  swap covers all four colour materials at once.

In-pass renderOrders mirror the GLSL stack: mask −1 → disc 0 → glow 3.5
(after the body surfaces, before the planet glare at 4).

## The disc draw writes no depth

The WebGL2 disc pass wrote `gl_FragDepth = 1.0` under its halo
fragments so later glow could peek through the haze — and that one
conditional write is what cost the whole pipeline its early rejection
of hidden fragments. Writing **no** depth from this draw buys the same
thing more directly: the halo leaves the buffer alone, so background
glow accumulates over it exactly as before, and a mesh behind the star
no longer punches a hole in the annulus through the depth test either.

**The core mask is where a core's depth comes from.** D3 draws at
renderOrder −4 over the *same* gate this draw runs — same three tests,
same kernel, one helper (`star-emission-tsl.ts` `discPassKernel`) — and
stamps every fragment with `glow ≥ uCoreThreshold`. That is exactly the
set the WebGL2 disc pass wrote fixed-function depth for, at exactly the
same value, several renderOrders earlier. So a depth write here would
be a second write of a value already in the buffer:

- Background layers draw **after** −4 and **before** 0, so only the
  mask can ever occlude them — the disc's write never could.
- The glow pass (renderOrder 1) tests against the mask's stamp.
- Two overlapping resolved discs: the nearer core's stamp rejects the
  farther one's fragments, as before. A core passes its own stamp
  because `LessEqualDepth` maps to greater-or-equal under reversed z.

Splitting the draw in two — a depth-writing core plus a
depthWrite-off halo — was the first cut, and it worked, but it doubled
this pass's per-corner cost: a second full 330k-instance draw running
the whole distance / magnitude / pulsation / colour-lookup chain to
re-derive varyings the first draw already had. Three draws is WebGL2's
own count; four was the migration costing more than the renderer it
replaces.

**In the local pass the same split holds with one caveat.** The mirror's
disc draw writes no depth either — its own mask (in-pass renderOrder −1)
stamps every member core's true bracket depth first, so the redundancy
argument carries over. What has no successor is the GLSL local-pass
halo's `gl_FragDepth = 1.0` write, which let a nearer member's halo
reopen depth over a farther member's stamped core; here that stamp
survives instead. The recorded fallback if close-pair smoke rejects the
difference is the viewport depth-range pin — bit-exact, at the price of
a per-draw viewport state change.

**What this gives up, and where.** The mask's `visible` gate is off
when no star's disc can reach `RESOLVED_DISC_MIN_PX` (5 px) —
`../../star-pipeline/README.md` § Star rendering. A disc *can* render
below that (the pass split has no pixel floor, only
`physSize ≥ 0.5 · pxSize`), and in that band a core now takes no part
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
a mask draw over a wider camera-distance band on **both** backends, and
of a gate that keys on a debug slider.
