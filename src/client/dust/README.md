# Dust particle layer (shelved)

Instanced additive billboards for the Edenhofer 2023 dust map's
importance-sampled particle field.

**Status: shelved, and slated for removal.** Strength = 0 → mesh hidden
→ zero per-frame cost, and `particles.bin` (~800 KiB) is not fetched at
load — the first `stellata.setParticleStrength(>0)` console call
triggers the lazy fetch + attach (`Stellata.setDustParticleSource`,
registered by `main.ts` when the dust manifest lists particles).

**Do not scope work around un-shelving this.** The decision is that we
are not visualising the Edenhofer dust field: two treatments were built
(a fullscreen fog raymarch, then these importance-sampled billboards)
and neither looked good enough to ship, so the finding is that the hard
part is the treatment, not the sampling or the render. This layer and
its graph (`../webgpu/dust/`) are being deleted rather than carried, and
a third attempt should start from the treatment question rather than from
either treatment. The voxel-extinction component of the dust map is
unaffected and stays live in the star pipeline (see
`../star-pipeline/extinction/README.md`) — it is a separate consumer of
the same data.

The declutter cycle reserves a floor slot (`dustParticles`, floor
`representational`) whose per-frame `detailPermits(...)` pull is unwired
while shelved. It is a reserved row for a layer that is going away, so
the removal retires the row with the layer rather than wiring it
(`../scene/declutter/README.md` — the floor table is exhaustive over a closed
union, so dropping a renderable means dropping its row).

`dust-particle-layer.ts` instantiates an `InstancedMesh` keyed to
`public/dust/particles.bin` (importance-sampled from
`data/dust/chunk_*.bin`; build script:
`scripts/dust/README.md`).

`DustField` + `dust-loader.ts` live in `src/client/loaders/`.

## The material seam

The layer takes its sprite surface from a `DustParticleMaterials` factory
and owns the attach / strength / dispose logic itself. Its geometry —
`aCorner`, `iPosition`, `iDensity` — is three vertex buffers, well inside
WebGPU's eight. The factory is
`../webgpu/dust/README.md`; `stellata.ts` passes
`webgpu.dustParticleMaterials`.

**Six of the seven uniforms are shared-by-reference and one is the
layer's.** The six come off the uniform-node mirror
(`../webgpu/dust/README.md` § Six of its seven uniforms), so
`uParticleStrength` is the only key in the slot record `setStrength`
writes.

`dust-particle-pure.ts` holds the footprint window, the dim floor and the
tint, which the sprite graph imports (`../webgpu/dust/README.md`
§ Constants live in TypeScript). `dust-materials.test.ts` carries the
seam's own guard — the layer-owned slot, and dispose severing the MRT
registration; `dust-materials-mock.ts` is the double the layer suite
builds on.
