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
