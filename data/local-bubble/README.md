# Local Bubble reference data

Frozen input + built product for the Local Bubble shell mesh
(`scripts/local-bubble/build-local-bubble.py`, consumed by
`src/client/local-bubble/`).

```
zucker2022-inner-surface.fits   HEALPix map (NSIDE 128, RING) of the
                                distance to the INNER (dust-traced) wall
                                of the Local Bubble in each galactic
                                direction, in parsecs. LFS (~14 MiB).
local-bubble.bin                Built shell mesh (magic LBUB). The frozen
                                PRODUCT of build-local-bubble.py, committed
                                like the dust grid so deploy needs no
                                astro-Python — sync-local-bubble.ts copies
                                it to public/ at build time. LFS (~650 KiB).
```

The binary table carries the raw dust-derived wall distance
(`r_inner_raw`) plus spherical-harmonic reconstructions truncated at
several ℓmax (`r_in_lmax-02` … `-40`); the build defaults to `lmax-08`
(smooth but structured). Wall distance ranges ~75–300 pc (mean ~213 pc)
— the Sun sits inside the cavity, off-centre.

## Provenance

- **Zucker C., Goodman A. A., Alves J., et al. 2022**, *Nature* 601, 334
  ("Star formation near the Sun is driven by the expansion of the Local
  Bubble"). DOI: [10.1038/s41586-021-04286-5](https://doi.org/10.1038/s41586-021-04286-5).
- **Surface data**: Harvard Dataverse
  [doi:10.7910/DVN/RHPVNC](https://doi.org/10.7910/DVN/RHPVNC),
  file `L19_map-inner_final.fits` (renamed here). The wall is traced
  through the Lallement et al. 2019 (L19) 3D dust map.
- **Licence**: as published on the Dataverse record.

## Refresh

Manual, per the frozen-external-data policy (`data/README.md`) — the
build never reaches the network. Re-fetch with:

```
curl -sL "https://dataverse.harvard.edu/api/access/datafile/6477817" \
  -o data/local-bubble/zucker2022-inner-surface.fits
pnpm run build:local-bubble
```

## Cross-validation

`build-local-bubble.py` asserts this surface against the **independent**
Edenhofer 3D dust grid (`data/dust/`): the dust density must peak at the
wall this map marks (per-ray peak-density radius median ≈ 0.96 R). The
two dust maps mutually confirm each other; the assertion also guards the
galactic→ICRS frame and pc-scale handling in the ingest.
