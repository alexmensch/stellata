# Molecular clouds on WebGPU

The graphs of the cloud layer's two surfaces: the absorption raymarch
that dims every diffuse layer behind a cloud, and the rim shell that
annotates its silhouette. These are the layer's only surfaces; the
physics is `../../molecular-clouds/absorption/README.md`'s and its
parent's, and that is where it is argued.

**Both are materials, not a layer.** The cloud layer owns all of its CPU
logic — geometry, per-cloud transforms, declutter and
chart gating, picking, labels, focus geometry — and takes its surfaces
through `../../molecular-clouds/README.md` § The material seam.

## Files in this area

```
src/client/webgpu/molecular-clouds/
  cloud-absorption-tsl.ts   The ellipsoid raymarch, in both tiers.
  cloud-rim-tsl.ts          The attenuated fresnel rim and the chart
                            stipple contour.
  cloud-uniform-nodes.ts    The seam's three uniform blocks as TSL nodes.
  tsl-cloud-materials.ts    The factory implementing CloudMaterials.
    (+ test)                Its suite is the seam's guard: each surface's
                            draw state, the per-cloud slots seeded from
                            the spec, and the tier's two graphs.
```

## The tier is compile-time, so it is two graphs

Choosing the traced brick march over the analytic Plummer profile is a
plain `if` in the **builder**, not a branch in the shader:
`buildCloudAbsorptionMaterial` takes a nullable field-node record and
emits one march or the other. So a cloud's tier is fixed for the
material's life, and a material built for the wrong `uUEnv` marches the
wrong envelope from its first frame — which is why those slots are seeded
from the spec rather than written over a neutral default.

That is also why the two tiers' uniforms are **two records**: the field
slots are not nullable members of the absorption record, because the graph
that reads them is a different graph.

## The absorption writes attachment 2, and that IS the gate

The fragment's output struct is the gate (`../hdr/README.md` § The gate
becomes the output struct), so the **same alpha-only texel** is returned
for `colour` and `diffuse`. Drop the second and the clouds keep drawing,
keep sorting correctly, and extinct nothing — no error, no missing draw,
just no dark rift. That is the absorber role
(`../../hdr/attachments/README.md` § The roles).

The statistic takes `vec4(0)`. Under this material's premultiplied-over
blend a zero source leaves the destination untouched — and an absorber has
no claim on the exposure statistic anyway.

**The blend is spelled out, and `premultipliedAlpha` is the one flag this
material may not set.** It would wrap the fragment output node and
silently demote the three-member struct to one attachment, failing the
WGSL compile on `m0` (`../hdr/README.md` § Two material flags silently
demote the struct — the failure this layer shipped with). So the blend it
selects is written out instead: `CustomBlending` with `OneFactor` /
`OneMinusSrcAlphaFactor` on both colour and alpha. The texel is
`vec4(vec3(0), alpha)`, so the shader-side premultiply the flag also implies
is arithmetically a no-op — only the factors were ever load-bearing.

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
  computed `end`. It is clamped in float and truncated once, which keeps
  a lone int node out of an otherwise float graph.

## The shared pair is not in this record

`uFovYRad` and `uViewport` come off the uniform-node mirror, so they are
absent from `cloudAbsorptionUniformNodes` and from the record the layer
writes — the same asymmetry the dust sprite carries
(`../dust/README.md`).

The brick's own slots are absent from the *written* record for a different
reason: nothing drives them after construction, and a texture node carries
no `.value` face a layer would want.

## `fwidth` spelled out

TSL has no `fwidth` node, so the chart contour's band width is
`abs(dFdx(x)) + abs(dFdy(x))`, `fwidth`'s definition. `MIN_FWIDTH` is
load-bearing: a facet with zero screen-space gradient would give a
zero-width band and drop the contour entirely. It lives in
`../../molecular-clouds/cloud-rim-pure.ts` with the rest of the rim's
authored numbers, and the graph imports it.

## 96 materials are not 96 pipelines

One absorption material per cloud looks like ~96 shader compiles. It is
not, and the mechanism is worth knowing before anyone "optimises" it:
three caches the compiled stage by
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
allows `dFdx` / `dFdy` inside. Each arm carries its own `Discard`.

The camera-distance attenuation rides the realistic arm only
(`../../fresnel-shell/README.md` § Camera-distance attenuation) — that arm
being the only path to the shared chunk is what excludes chart mode.

The realistic arm discards at `rimAlpha <= 0`. Under additive blending a
zero-alpha fragment contributes nothing, so this only drops the
sub-half-level dither on a rim that had no alpha to begin with — and it
drops the fragment's blend with it.

The layer swaps `material.blending` across the chart flip with no
`needsUpdate` beside it. The renderer compares `material.blending` against the render object's recorded value on
its own (`WebGPUBackend.needsRenderUpdate`), so the pipeline is rebuilt
from the assignment alone; a version bump would only re-derive the cache
key for every rim mesh sharing the material.
