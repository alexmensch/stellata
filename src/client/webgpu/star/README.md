# Star layer on WebGPU

The TSL star pipeline behind `#renderer=webgpu`, constructed through
`WebGpuSeam.attachStarLayer` (never imported from `stellata.ts` — the
import boundary in `../README.md`). Today it carries the **D2 glow
pipeline only**: the full vertex stage plus the additive glow fragment,
with no depth output of any kind. The WebGL2 pipeline
(`../../star-pipeline/`) stays the shipped renderer and the semantic
reference; parity is verified by the A/B smoke, same `/v/<blob>/` with
and without the fragment.

## Files in this area

```
src/client/webgpu/star/
  star-geometry.ts (+ test)    Packed instanced geometry: aCorner,
                               iPosition (shared), iPuls, iPack0-2,
                               iDyn0 — 7 of the 8 vertex buffers
                               (../README.md § Attribute packing).
  star-glow-tsl.ts             The D2 material: vertex stage + glow
                               fragment as TSL graphs over the shared
                               uniform nodes and the pack plans.
  perceptual-disc-tsl.ts       TSL mirror of the stellata_perceptual_disc
                               chunk (dM knee, √Δm size, exponent,
                               profile). The GLSL chunk's header owns the
                               math.
  star-layer.ts (+ test)       StarLayer: geometry + material + mesh into
                               the seam's scene, the per-frame dynamic
                               re-pack, dispose.
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
- **Disc, core mask (D3/D4)**: resolved close-range stars have no disc —
  the glow pass discards `vPhysRatio ≥ 0.5`, so a star vanishes as the
  camera closes in past the pass split.
- **Chart mode**: under additive blending on the paper background, chart
  currently renders no stars on WebGPU.
- **MRT emission/statistic chunks**: the fragment writes colour only;
  the inline operator path is exact for point sources
  (`../../hdr/README.md` § Fallback).
- **Local-mirror clones**: a local-pass member collapses in this layer
  (as in the main WebGL pass) with no mirror to repaint it.

## Dynamic attributes — who uploads what

The shell constructs the WebGL `StarPipeline` on every boot; on a WebGPU
boot its meshes never render, but its **attributes are the live source
buffers** every writer (BinaryOrbitField, EclipsePhotometryField,
StarFrame's recentre, the shell's re-attach inits) keeps writing. This
layer taps them without any writer learning about the port:

- **iPosition** joins this geometry **by object identity** — the same
  `InstancedBufferAttribute`; a `needsUpdate` flip reaches whichever
  renderer draws it.
- **The three per-frame scalars** (`iCompositeSuppress`, `iEclipseDim`,
  `iSuppressPulsation`) interleave into the packed `iDyn0` vec4, so they
  cannot share the object. `StarLayer` version-watches each source
  attribute from the glow mesh's `onBeforeRender` and re-packs the
  changed component; watcher sentinels start at -1 so the first rendered
  frame always packs. A dirty frame re-uploads the whole vec4 buffer
  (4× the WebGL scalar upload) — the packing-era cost;
  `instance_index`-indexed storage buffers supersede it after the
  compute prepass.

## Suppression semantics carried by the glow specialization

Compile-time D2 replaces the `uRenderMode == 0` branches: the hidden
focal star and local-pass members collapse to the clip sentinel; eclipse
totality collapses; a partial `iEclipseDim` folds into `appMag` before
any size/brightness derivation; `iCompositeSuppress` never gates glow
(the summed pair is the point). `uPinFocusToCenter` substitutes the
canonical projection exactly as the GLSL does.
