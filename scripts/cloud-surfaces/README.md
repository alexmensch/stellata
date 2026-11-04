# Cloud surface build

`build-cloud-surfaces.py` (the entry; the numpy-bound bake is
`trace_surfaces.py`) traces a per-cloud **isosurface mesh** from the
[Edenhofer 2024](/data/papers/index.md#edenhofer2024) dust posterior mean
for every Zucker cloud → `data/molecular-clouds/cloud-surfaces.bin`, consumed by
the molecular-cloud rim shells
([Rim shell render](/src/client/molecular-clouds/README.md#rim-shell-render)).
In-grid clouds sample the standard 1.25 kpc posterior; out-of-grid clouds sample
the noisier `less_data_but_2kpc` flavor (reaches 2 kpc). A cloud whose peak
in-envelope density never clears its iso threshold gets no entry and keeps its
ellipsoid rim shape — clouds beyond the 2 kpc reach (Carina, IC 2944, RCW38) and
globules [Edenhofer 2024](/data/papers/index.md#edenhofer2024) doesn't
resolve (the CB/LBN/Draco spheres) among them.

Like the dust grid and the Local Bubble, the Python build runs
**offline** and its output is **committed** (LFS). The deploy build
never runs it: `build:cloud-surfaces-sync` (`sync-cloud-surfaces.ts`,
reading through `cloud-surfaces-source.ts`,
in the `pnpm run build` chain) just copies the committed binary →
`public/cloud-surfaces.bin`, and fails when the binary is missing or an
unsmudged LFS pointer. Regenerate offline and commit:

```
./.venv/bin/pip install -r scripts/cloud-surfaces/requirements.txt
pnpm run build:clouds                    # sid-stamped clouds.json first
pnpm run build:cloud-surfaces            # under the venv's python3
```

It reads the [Edenhofer 2024](/data/papers/index.md#edenhofer2024) cube
from `dustmaps`' cache, which the two dataset pulls fill
([The Edenhofer 2024 pulls](/scripts/dust/README.md#the-edenhofer-2024-pulls)):
in-grid clouds need `edenhofer2024-main.json`, out-of-grid ones
`edenhofer2024-2kpc.json`. `--only <cloud-id>` and `--dry-run` help when
tuning; a run with arguments writes no record, so it reads stale until a
plain run ([Recording a manual step](/scripts/pipeline/README.md#recording-a-manual-step--recordts)).

## What stales the bake

The bake is a manual step ([Step kinds](/scripts/pipeline/README.md#step-kinds)):
`pnpm run build:cloud-surfaces` runs it through `record.ts`, which writes
`data/stamps/build-cloud-surfaces.json`. It reads `public/clouds.json` only
for the geometry it traces, so its record holds the hash of that projection
(`cloud_geometry.py`: each cloud's `id`, `sid`, `center`, `axes`, `quat`
and `inGrid`), never of the file: a name change leaves the bake fresh; a
geometry change, or an SID change (the bake keys each entry by `sid`), stops
the build naming this command. `build-cloud-surfaces.py
--describe` prints the projection with the standard library alone, which is
why the numpy body lives in `trace_surfaces.py`. Its other inputs are the
two Edenhofer identity files and its own code, recorded as it runs.

## Pipeline (per cloud)

1. Sample the dustmaps GP posterior mean on a ~0.5 pc grid over the
   cloud's world-frame bbox — deliberately **not** the 4.88 pc runtime
   voxel grid; the volumes are small, so near-native-resolution sampling
   is cheap. Larger clouds coarsen so no grid exceeds 256³ (an
   offline-only cap on query cost, ∝ dim³).
2. Taper density to zero over ellipsoid radius u ∈ [0.95, 1.05] so
   surfaces close inside the bbox and a neighbouring cloud's dust
   can't leak in.
3. Marching cubes at `iso = max(floor, 0.25 × p99)` of the in-envelope
   density — per-cloud adaptive with a physical floor (0.005 E_ZGR/pc by
   default); clouds where
   [Edenhofer 2024](/data/papers/index.md#edenhofer2024) sees nothing
   above it are skipped (renderer falls back to the ellipsoid). `ISO_FLOOR_OVERRIDES` lowers
   the floor per cloud for weak in-grid globules and distant HII regions
   that carry faint-but-real signal the global floor would reject —
   surgical, so the well-resolved clouds keep their default calibration.
4. Drop speckle components (< max(50, 2%) of faces), Taubin-smooth
   (volume-preserving), decimate to ≤ 6000 triangles
   (`fast-simplification`), and orient winding **outward** via the
   signed-volume test — the renderer's FrontSide material relies on it
   for the hide-when-inside cull.
5. Ship the sampled volume itself as a **density brick** — mean-pooled
   to ≤ 72 texels per axis, linear uint8 against the per-cloud max —
   so the runtime absorption raymarch integrates the exact field the
   isosurface was traced from (shadow ↔ silhouette 1:1).

## Output format (`cloud-surfaces.bin`, magic `CSUR`, v3)

Magic and version come from `src/astro-core/baker-constants.json`
(`artifacts.cloudSurfaces`), which the client loader checks against too;
a format change bumps the version there.

- Header (16 B): `CSUR` · uint32 version · uint32 cloudCount ·
  float32 envelope — `ENVELOPE_HI`, the ellipsoidal radius u where the
  step-2 taper has taken every brick's density to zero. The client marches
  each traced cloud out to it, so it is written here rather than restated
  there.
- Directory (cloudCount × 44 B): uint32 sid · uint32 vertexCount ·
  uint32 indexCount (u32s, = 3 × triangles) · uint32×3 brick dims ·
  float32×3 brick aabbMin (ICRS pc, texel (0,0,0)'s sample position) ·
  float32 brick step (pc) · float32 densityMax (E_ZGR/pc at 255).
- Blobs in directory order: `vertexCount × float32×3` positions
  (ICRS pc, Sol origin), `indexCount × uint32` indices, then
  `dims[0]·dims[1]·dims[2]` brick bytes (x-fastest — WebGL 3D-texture
  layout).

Parsed by `src/client/molecular-clouds/cloud-surfaces-loader.ts`
(sid-keyed map); `/tests/integration/cloud-surfaces.test.ts` here pins the committed
binary against the built `clouds.json` (both self-skip when absent).
