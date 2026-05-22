# Edenhofer 2023 3D dust map (resampled)

Voxel-grid + importance-sampled particle field for interstellar dust
extinction. Render-time consumers raymarch the voxel grid in the star
vertex shader to dim and redden stars behind dense ISM.

```
chunk_X_Y_Z.bin   64 voxel chunks, 2 MiB each. LFS. Together: a 512³
                  uint8 density grid in ICRS heliocentric Cartesian
                  pc, axes matching catalog.bin.
particles.bin     50K importance-sampled dust points (LFS).
manifest.json     grid params + chunk index + particle count.
                  ~1 KB, regular git.
```

## Provenance

- **Citation**: Edenhofer G., Zucker C., Frank P., Saydjari A. K.,
  Schlafly E. F., Green G. M., Enßlin T. A. 2024, *A&A* 685, A82
  (the "Edenhofer 2023" map).
  DOI: [10.1051/0004-6361/202347628](https://doi.org/10.1051/0004-6361/202347628).
- **Upstream data**: [Zenodo 8187943](https://doi.org/10.5281/zenodo.8187943).
- **Licence**: CC-BY-4.0. The resampled grid + particles here are
  derivatives and carry the same licence.
- **Resampling**: `scripts/dust/build-dust.py` pulls via the
  `dustmaps` Python package and bins onto a 512³ Cartesian voxel
  grid; see [`scripts/dust/README.md`](../../scripts/dust/README.md).

## Encoding

`manifest.json` is the contract — `scripts/dust/build-dust.py` and
`src/client/loaders/dust-loader.ts` both derive constants from it.
Voxel density is `uint8: 255 · (log10(clamp(d, dmin, dmax)) -
log10(dmin)) / log10(dmax/dmin)` over `[densityMin, densityMax]`;
runtime A_V is `density · avPerDensityPerPc · path_length_pc` with
`avPerDensityPerPc ≈ 2.742`.

## Consumed by

- Runtime: [`src/client/loaders/dust-loader.ts`](../../src/client/loaders/README.md)
  → `DustField` → star vertex shader raymarch.
- Particle layer is shelved (strength = 0 → hidden); voxel
  extinction stays live in the star pipeline.

## Refresh

Re-run `scripts/dust/build-dust.py` against an updated upstream
release — no npm target, see
[`scripts/dust/README.md`](../../scripts/dust/README.md). The build
does NOT hit the network at run time.
