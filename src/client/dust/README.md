# Dust particle layer (shelved)

Instanced additive billboards for the Edenhofer 2023 dust map's
importance-sampled particle field.

**Status: shelved.** Strength = 0 → mesh hidden → zero per-frame cost,
and `particles.bin` (~800 KiB) is not fetched at load — the first
`stellata.setParticleStrength(>0)` console call triggers the lazy fetch
+ attach (`Stellata.setDustParticleSource`, registered by `main.ts`
when the dust manifest lists particles). Machinery preserved here so
the layer can be re-enabled with a one-knob flip once the visual
treatment is refined. The voxel-extinction component of the dust map
remains live in the star pipeline (see
`../star-pipeline/extinction/README.md`), independent of this
particle-render layer.

The declutter cycle reserves a floor slot (`dustParticles`, floor
`representational`) whose per-frame `detailPermits(...)` pull is unwired
while shelved — gate the mesh's visibility on it at un-shelve
(`../scene/README.md`).

`dust-particle-layer.ts` instantiates an `InstancedMesh` keyed to
`public/dust/particles.bin` (importance-sampled from
`data/dust/chunk_*.bin`; build script:
`scripts/dust/README.md`).

`DustField` + `dust-loader.ts` live in `src/client/loaders/`.

## The material seam

The layer takes its sprite surface from a `DustParticleMaterials` factory
rather than building a `ShaderMaterial` directly, so a WebGPU boot swaps
shaders with no second copy of the attach / strength / dispose logic. The
geometry crosses backends unchanged — `aCorner`, `iPosition`, `iDensity`
is three vertex buffers, well inside WebGPU's eight — which is why this is
a material swap rather than a layer of its own. The WebGPU twin is
`../webgpu/dust/README.md`; `stellata.ts` passes
`webgpu?.dustParticleMaterials` and falls back to
`makeGlslDustParticleMaterials()`.

**Six of the seven uniforms are shared-by-reference and one is the
layer's.** On WebGL the six come straight off the shared map; on WebGPU
they come off the uniform-node mirror and the factory ignores its
`shared` argument entirely (`../webgpu/dust/README.md` § Six of its seven
uniforms). Only `uParticleStrength` appears in the slot record `setStrength`
writes, so that one call reaches either backend.

`dust-particle-pure.ts` holds the footprint window, the dim floor and the
tint, so the TSL twin imports what the GLSL can only copy;
`dust-particle-glsl-drift.test.ts` pins the copies.
