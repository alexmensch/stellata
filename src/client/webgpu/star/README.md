# Star layer on WebGPU

The TSL star pipeline behind `#renderer=webgpu`, constructed through
`WebGpuSeam.attachStarLayer` (never imported from `stellata.ts` — the
import boundary in `../README.md`). It carries the four depth-honest
pipelines of `../README.md` § Early-z: D2 glow (no depth output), D3
core mask (depth-only, member stamp in the vertex stage), and the D4
disc core/halo split (fixed-function depth on the core draw alone). No
pipeline here writes fragment depth. The WebGL2 pipeline
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
  star-disc-tsl.ts             The D4 split: disc-core (depth write) +
                               disc-halo (no depth write) — § The disc
                               split is depth-honest.
  star-core-mask-tsl.ts        The D3 material: depth-only, colour
                               writes off, disc-pass gates.
  star-emission-tsl.ts         Fragment pieces the colour passes share:
                               profile value, starEmission()'s
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
- **Local-mirror clones**: a local-pass member collapses in this layer
  (as in the main WebGL pass) with no mirror to repaint it.

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
GLSL does.

## The disc split is depth-honest

The WebGL2 disc pass wrote `gl_FragDepth = 1.0` under its halo
fragments so later glow could peek through — which also let any mesh
behind the star punch a hole in the halo annulus via the depth test.
The split ships **real depth** instead: the halo draw tests at its own
fragment depth and writes none, so glow still accumulates over it and a
planet behind the host no longer cuts the annulus — the physically
ordered outcome from every vantage. Buffer content is unchanged (the
far-plane write only ever rewrote 1.0 over 1.0). The recorded fallback,
if smoke rejects the halo's now-physical test: keep the split and pin
the halo draw's depth window to the far end via viewport
minDepth = maxDepth — bit-exact WebGL2 semantics, early-z intact.
