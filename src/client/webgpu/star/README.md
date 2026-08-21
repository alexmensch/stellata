# Star layer on WebGPU

The TSL star pipeline behind `#renderer=webgpu`, constructed through
`WebGpuSeam.attachStarLayer` (never imported from `stellata.ts` — the
import boundary in `../README.md`). It carries the three depth-honest
pipelines of `../README.md` § Early-z: D2 glow (no depth output), D3
core mask (depth-only, member stamp in the vertex stage), and D4 disc
(colour only, no depth output either — § The disc draw writes no
depth). No pipeline here writes fragment depth, and the draw count
matches the WebGL2 stack one for one. The WebGL2 pipeline
(`../../star-pipeline/`) stays the shipped renderer and the semantic
reference; parity is verified by the A/B smoke, same `/v/<blob>/` with
and without the fragment.

## Files in this area

```
src/client/webgpu/star/
  star-geometry.ts (+ test)    Packed instanced geometry: aCorner,
                               iPosition + iPuls (both shared by object
                               identity), iPack0-2, iDyn0 — 7 of the 8
                               vertex buffers (../README.md
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
  star-emission-tsl.ts         Fragment pieces the colour passes share:
                               the kernel and the disc gate BOTH disc
                               and core mask run, starEmission()'s
                               inline-operator select, the MRT output
                               struct + single↔struct mode swap
                               (../hdr/README.md).
  perceptual-disc-tsl.ts       TSL mirror of the stellata_perceptual_disc
                               chunk (dM knee, √Δm size, exponent,
                               profile). The GLSL chunk's header owns the
                               math.
  star-layer.ts (+ test)       StarLayer: geometry + the four meshes into
                               the seam's scene, the per-frame dynamic
                               re-pack, the shell's core-mask gate,
                               dispose.
  star-sources-mock.ts         StarGeometrySources over the zero-filled
                               StarPipeline mock, for tests.
```

The operator and emission-unit mirrors the fragment composes live one
level up (`../tonemap-tsl.ts`, `../emission-tsl.ts`) — they are
layer-agnostic and every ported emitter will take them.

## What is deliberately NOT here yet

Each is a sibling port child of the star-pipeline epic, and its absence
is visible in a WebGPU A/B smoke until it lands:

- **Extinction reads** (prepass texelFetch + in-vertex raymarch
  fallback): stars toward dusty sightlines render *brighter and bluer*
  than WebGL2 until then.
- **Chart mode**: under additive blending on the paper background, chart
  currently renders no stars on WebGPU.
- **Local-mirror clones**: none exist yet, so local-pass membership is
  parked on this boot (`../../star-pipeline/local-pass/README.md`
  § Membership) — close-range discs render in the MAIN pass, ordered by
  the core mask's reversed-z float32 stamps (§ The disc draw writes no
  depth), rather than collapsing into a repaint that is not there. The
  collapse returns with the mirrors, and the member near-pin in the
  vertex stage is inert until then: with no members, nothing pins.

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
  313k-iteration re-pack on the CPU plus a **5.0 MB** `writeBuffer`
  (313k × vec4 × 4 B), against 1.25 MB for the WebGL scalar it replaces.
  During an active eclipse that is **every frame**: ~300 MB/s of upload
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
  folds into `appMag` before any size/brightness derivation;
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
GLSL does. Every pass also carries the taper cull, and the colour passes
the kernel collapse — the exactness and flux-preservation arguments are
`../../star-pipeline/collapse/README.md`'s, one mechanism on both
backends.

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
this pass's per-corner cost: a second full 313k-instance draw running
the whole distance / magnitude / pulsation / colour-lookup chain to
re-derive varyings the first draw already had. Three draws is WebGL2's
own count; four was the migration costing more than the renderer it
replaces.

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
