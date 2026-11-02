# Baker constants

`constants.json` is the one spelling of every fact the Python asset bakers
(dust, cloud surfaces, Local Bubble, textures, and the cloud model behind
`build-clouds.py`) share with TypeScript. Neither language owns a copy:
TypeScript reads it through `src/client/util/baker-constants.ts`, Python
through `scripts/util/baker_constants.py` (`CONSTANTS`, a plain
`json.load`).

Not external data, and nothing here is frozen: a value changes by editing
this file, after which every reader agrees by construction. A value that
is a property of one artifact — a build parameter the client needs to
read that artifact back — travels in the artifact instead, written by its
baker; this file holds what both sides need *before* any artifact exists.

## Adding a fact

1. Add the key here, camelCase, units in the name (`…Deg`, `…Km`, `…Pc`).
2. Export it from `baker-constants.ts` under an explicit readonly type —
   the wrapper is the only TypeScript module that imports the JSON.
3. Read it in Python from `CONSTANTS`. A Python entry point puts the repo
   root on `sys.path` so `scripts.util` imports.
4. Delete the old copies on both sides in the same commit.
5. A Python builder with an up-to-date gate lists `CONSTANTS_PATH` among
   the gate's inputs, so editing a value it reads rebuilds its output.

## Blocks

| Key | What | TS readers | Python readers |
|---|---|---|---|
| `galacticFrame` | J2000 IAU galactic centre and north pole, ICRS degrees | `galactic/galactic-coords.ts` | `scripts/clouds/cloud_model.py` |
| `artifacts` | Version (and, for binaries, 4-byte magic) of each baker-written artifact: `clouds`, `dustManifest`, `cloudSurfaces`, `localBubble` | each artifact's loader, via `checkBinaryHeader` for the binaries | each artifact's writer; `build-cloud-surfaces.py` also gates on the `clouds` version it reads |
| `planetShading` | Limb-darkening floor and exponent, and the terminator-softness floor, of the planet mesh shader | `planet-mesh-tsl.ts`, `mesh-surface-pure.ts` | `scripts/textures/measure_relief_lighting.py` |
| `surfaceRelief` | Horizon-map azimuth count and sine range, sky-view range, and per relief body its radius, albedo, colour-map centre longitude and DEM elevation span (Earth's floor is the sea surface: the DEM is clamped there) | `planet-system.ts`, `rotation-elements-pure.ts`, `surface-relief-pure.ts`, `planet-mesh-layer.ts`, `planet-mesh-tsl.ts` | `dem_relief.py` (merged into `DEM_BODIES`), `horizon_map.py`, `sky_view.py`, `measure_relief_lighting.py` |
| `ringSpans` | Uranus's and Neptune's ring annuli, km | `planet-system.ts` `rings` | `build-textures.py` `RING_TABLES` |
| `extinction` | `avPerEzgr`, A_V per unit Edenhofer dust density; `avPerNhPc`, A_V per pc per n_H cm⁻³ ([§ 2](/docs/science-molecular-clouds.md#2-extinction-physics-and-the-units-chain)) | cloud absorption graph, Milky Way column, shared-uniforms seed | `cloud_model.py`, `build-dust.py` (which writes `avPerEzgr` into the dust manifest) |
