# Molecular clouds on WebGPU

The TSL half of the cloud layer's two surfaces: the absorption raymarch
that dims every diffuse layer behind a cloud, and the rim shell that
annotates its silhouette. The WebGL2 shaders (`../../molecular-clouds/`)
stay the shipped renderer and the semantic reference; the physics is not
re-decided here.

**Both port as a material swap, not a layer.** The cloud layer keeps every
line of its CPU logic — geometry, per-cloud transforms, declutter and
chart gating, picking, labels, focus geometry — and takes its surfaces
through `../../molecular-clouds/README.md` § The material seam.

## Files in this area

```
src/client/webgpu/molecular-clouds/
  cloud-absorption-tsl.ts   The ellipsoid raymarch, in both tiers.
  cloud-rim-tsl.ts          The fresnel rim and the chart stipple contour.
  cloud-uniform-nodes.ts    TSL uniform-node twins of the seam's three
                            uniform blocks, transcribed key-for-key.
  tsl-cloud-materials.ts    The factory implementing CloudMaterials.
```

## The tier is compile-time, so it is two graphs

The GLSL selects the traced brick march over the analytic Plummer profile
with a `USE_FIELD` define. Here it is a plain `if` in the **builder**, not
a branch in the shader: `buildCloudAbsorptionMaterial` takes a nullable
field-node record and emits one march or the other. Same consequence as
the define — a cloud's tier is fixed for the material's life, and a
material built for the wrong `uUEnv` marches the wrong envelope from its
first frame, which is why those slots are seeded from the spec rather than
written over a neutral default.

That is also why the two tiers' uniforms are **two records**: the field
slots are not nullable members of the absorption record, because the graph
that reads them is a different graph.

## The absorption writes attachment 2, and that IS the gate

On WebGL the mesh is `markAbsorber`ed so the draw-buffer gate opens
attachment 2. Here the fragment's output struct is the gate
(`../hdr/README.md` § The gate becomes the output struct), so the **same
alpha-only texel** is returned for `colour` and `diffuse`. Drop the second
and the clouds keep drawing, keep sorting correctly, and extinct nothing —
no error, no missing draw, just no dark rift.

`markAbsorber` stays on the mesh and is simply inert on this backend: it
sets state the WebGL pipeline reads, and a WebGPU boot never constructs
that pipeline.

The statistic takes `vec4(0)`. Under this material's premultiplied-over
blend a zero source leaves the destination exactly as the WebGL gate's
`NONE` did — and an absorber has no claim on the exposure statistic
anyway.

## Three WGSL rules this march lives under

- **`discard` is not a return.** The invocation keeps running, so the
  arithmetic after the envelope test still executes on a fragment that
  will be thrown away. `sqrt(max(disc, 0))` keeps `t0` / `t1` finite on a
  miss, and the whole march is wrapped in `If(hit, …)` — the same
  condition it discards on — so a miss pays for no loop and never divides
  by a zero-length chord.
- **A jump out of a concise arrow is emitted twice.** The saturation
  `break` is braced (`() => { Break(); }`), and the analytic tier's
  `continue` is expressed as the branch it guarded instead
  (`../tsl/README.md` § TSL test pattern).
- **The loop bound is a node, not a constant.** The step count is
  screen-adaptive and capped by the `uSteps` dev lever, so `Loop` takes a
  computed `end`. It is clamped in float and truncated once, rather than
  GLSL's truncate-then-clamp — identical for every input, and it keeps a
  lone int node out of an otherwise float graph.

## The shared pair is not in this record

`uFovYRad` and `uViewport` are shared by reference on the WebGL path and
come off the uniform-node mirror here, so they are absent from
`cloudAbsorptionUniformNodes`. The key-parity test accounts for exactly
that pair rather than asserting a bare set equality — the same asymmetry
the dust sprite carries (`../dust/README.md`).

The brick's own slots are absent from the *written* record for a different
reason: nothing drives them after construction, and a texture node carries
no `.value` face a layer would want.

## `fwidth` spelled out

TSL has no `fwidth` node, so the chart contour's band width is
`abs(dFdx(x)) + abs(dFdy(x))` — which is what GLSL's `fwidth` is defined
as. `MIN_FWIDTH` is load-bearing: a facet with zero screen-space gradient
would give a zero-width band and drop the contour entirely. It lives in
`../../molecular-clouds/cloud-rim-pure.ts` with the rest of the rim's
authored numbers, and the GLSL's bare copy is pinned against it.

## 96 materials are not 96 pipelines

One absorption material per cloud looks like ~96 shader compiles where the
WebGL2 build linked two programs. It is not, and the mechanism is worth
knowing before anyone "optimises" it: three caches the compiled stage by
the **generated WGSL source string**, and a uniform's name in that source
is `nodeUniform<n>` off a per-builder counter rather than anything derived
from the node's identity. Every cloud on a tier therefore generates
byte-identical source and shares one stage; the pipeline on top of it is
keyed by blend / depth / side / attachment format / geometry, which they
also share. Two tiers × the single-output and struct graphs = four
pipelines, not 192.

What *is* per material is the node-graph build and the code generation that
feeds that cache — doubled, since `finishMrtMaterial` runs the builder once
per graph. That is CPU work at first render of each cloud, the same shape
the per-planet materials already carry, and it is **unmeasured**: no
`gpu.frame` differential prices it, and it would not appear in one anyway.

## One rim graph, both modes

`uChart` selects between the fresnel rim and the stipple inside a single
graph rather than swapping materials: the flip is frequent enough that a
pipeline rebuild per chart toggle would cost more than the branch.

The branch is an `If().Else()` and **not** a `select`, which is the
difference between paying for one arm and paying for both: a `select` is a
value pick, so its operands are always evaluated, and the realistic mode
would carry two screen-space derivatives, a `fract`, two `smoothstep`s and
a `length` it never reads (chart mode, the fresnel `pow` and the dither).
`uChart` is a uniform, so branching on it is *uniform* control flow —
coherent across the whole draw, and the one kind of branch WGSL still
allows `dFdx` / `dFdy` inside. Each arm carries its own `Discard`, which is
also what the GLSL's early `return` out of the chart branch expresses.

One deliberate difference from the GLSL: the realistic arm discards at
`rimAlpha <= 0`, where the GLSL writes `max(alpha + dither, 0)`
unconditionally. Under additive blending a zero-alpha fragment contributes
nothing, so this only drops the sub-half-level dither on a rim that had no
alpha to begin with — and it drops the fragment's blend with it.

The layer still swaps `material.blending` across the chart flip, exactly
as it did on the WebGL path — no `needsUpdate` with it. This backend
compares `material.blending` against the render object's recorded value on
its own (`WebGPUBackend.needsRenderUpdate`), so the pipeline is rebuilt
from the assignment alone; a version bump would only re-derive the cache
key for every rim mesh sharing the material.
