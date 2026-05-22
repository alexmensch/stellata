# Dust particle layer (shelved)

Instanced additive billboards for the Edenhofer 2023 dust map's
importance-sampled particle field.

**Status: shelved.** Strength = 0 → mesh hidden → zero per-frame cost.
Machinery preserved here so the layer can be re-enabled with a one-knob
flip once the visual treatment is refined. The voxel-extinction
component of the dust map remains live in the star pipeline as a
vertex-shader raymarch — see `src/client/star-pipeline/README.md`
§ Dust extinction.

`dust-particle-layer.ts` instantiates an `InstancedMesh` keyed to
`public/dust/particles.bin` (importance-sampled from
`data/dust/chunk_*.bin`; build script:
`scripts/dust/README.md`).

`DustField` + `dust-loader.ts` live in `src/client/loaders/`.
