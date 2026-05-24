# Dust resampler

`build-dust.py` — Edenhofer 2024 dust posteriors → resampled voxel
chunks + importance-sampled particle field. Outputs to `data/dust/`
(LFS-committed). `sync-dust.ts` mirrors `data/dust/` → `public/dust/`
on dev/build.

Python deps in `requirements-dust.txt`.

Particle-layer rendering is currently shelved (strength = 0 → mesh
hidden); voxel extinction (read per-star in the star pipeline) stays
live.

## Output layout

Canonical; must stay in sync with `src/client/dust-loader.ts`:

```
data/dust/
  manifest.json          # grid params, chunk index, encoding constants
  chunk_XXX_YYY_ZZZ.bin  # raw uint8 voxels, 128**3 = 2,097,152 bytes each
```

Grid: 512³ voxels total, split into 4³ = 64 chunks of 128³. Covers a
symmetric cube [-1250, +1250] pc on each axis in heliocentric
equatorial (ICRS) Cartesian — same frame as `catalog.bin` so the
renderer samples the texture using raw star xyz with no rotation.
Voxel size ≈ 4.883 pc.

## Encoding

Edenhofer density spans ~6 orders of magnitude (1e-7 diffuse ISM to
~1e-1 dense cloud cores). Linear or log1p encoding collapses this
range poorly. We use pure log encoding over a fixed `[DENSITY_MIN,
DENSITY_MAX]` window:

```
log_clamped = log10(clamp(d, d_min, d_max))
encoded     = round(255 * (log_clamped - log10(d_min)) / log10(d_max/d_min))
decoded     = d_min * pow(d_max/d_min, encoded/255)   # shader
```

`DENSITY_MIN` sits below the noise floor (~1e-7) so "empty" voxels
decode to a vanishingly small density (integrates to < 0.01 mag A_V
over realistic sightlines). `DENSITY_MAX` covers the 99.95th
percentile of real data — the few hundred voxels above it saturate
but still decode as "very dense" so the visual effect is preserved.

## Usage

```
python3 scripts/dust/build-dust.py                # fetch + resample real map
python3 scripts/dust/build-dust.py --synthetic    # fake pattern for dev
python3 scripts/dust/build-dust.py --flavor less_data_but_2kpc  # extended-range run
```

Real mode needs `pip install -r scripts/requirements-dust.txt` and
downloads ~3.2 GB via `dustmaps` on first run.
