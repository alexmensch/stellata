# Cloud surface build

`build-cloud-surfaces.py` traces a per-cloud **isosurface mesh** from
the Edenhofer 2023 dust posterior mean for every in-grid Zucker cloud
→ `data/molecular-clouds/cloud-surfaces.bin`, consumed by the
molecular-cloud rim shells (`src/client/molecular-clouds/README.md`
§ Rim shell render). Out-of-grid clouds (18 of 96) get no entry and
keep their ellipsoid rim shapes.

Like the dust grid and the Local Bubble, the Python build runs
**offline** and its output is **committed** (LFS). The deploy build
never runs it: `build:cloud-surfaces-sync` (`sync-cloud-surfaces.ts`,
in the `pnpm run build` chain) just copies the committed binary →
`public/cloud-surfaces.bin`. Regenerate offline and commit:

```
./.venv/bin/pip install -r scripts/cloud-surfaces/requirements.txt
pnpm run build:clouds                    # sid-stamped clouds.json first
./.venv/bin/python scripts/cloud-surfaces/build-cloud-surfaces.py
```

First run downloads the ~3 GB Edenhofer cube via `dustmaps` (same
cache as `scripts/dust/`). `--only <cloud-id>` and `--dry-run` help
when tuning.

## Pipeline (per cloud)

1. Sample the dustmaps GP posterior mean on a ~1.25 pc grid over the
   cloud's world-frame bbox — deliberately **not** the 4.88 pc runtime
   voxel grid; the volumes are small, so native-resolution sampling is
   cheap. Giant Z2020 spheres coarsen so no grid exceeds 144³.
2. Taper density to zero over ellipsoid radius u ∈ [0.95, 1.05] so
   surfaces close inside the bbox and a neighbouring cloud's dust
   can't leak in.
3. Marching cubes at `iso = max(0.005 E_ZGR/pc, 0.25 × p99)` of the
   in-envelope density — per-cloud adaptive with a physical floor;
   clouds where Edenhofer sees nothing above the floor are skipped
   (renderer falls back to the ellipsoid).
4. Drop speckle components (< max(50, 2%) of faces), Taubin-smooth
   (volume-preserving), decimate to ≤ 2400 triangles
   (`fast-simplification`), and orient winding **outward** via the
   signed-volume test — the renderer's FrontSide material relies on it
   for the hide-when-inside cull.
5. Ship the sampled volume itself as a **density brick** — mean-pooled
   to ≤ 56 texels per axis, linear uint8 against the per-cloud max —
   so the runtime absorption raymarch integrates the exact field the
   isosurface was traced from (shadow ↔ silhouette 1:1).

## Output format (`cloud-surfaces.bin`, magic `CSUR`, v2)

- Header (16 B): `CSUR` · uint32 version · uint32 cloudCount ·
  uint32 reserved.
- Directory (cloudCount × 44 B): uint32 sid · uint32 vertexCount ·
  uint32 indexCount (u32s, = 3 × triangles) · uint32×3 brick dims ·
  float32×3 brick aabbMin (ICRS pc, texel (0,0,0)'s sample position) ·
  float32 brick step (pc) · float32 densityMax (E_ZGR/pc at 255).
- Blobs in directory order: `vertexCount × float32×3` positions
  (ICRS pc, Sol origin), `indexCount × uint32` indices, then
  `dims[0]·dims[1]·dims[2]` brick bytes (x-fastest — WebGL 3D-texture
  layout).

Parsed by `src/client/molecular-clouds/cloud-surfaces-loader.ts`
(sid-keyed map); `cloud-surfaces.test.ts` here pins the committed
binary against the built `clouds.json` (both self-skip when absent).
