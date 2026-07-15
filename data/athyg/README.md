# AT-HYG v3.3 — stellar catalogue (classic-IDs subset)

The base stellar catalogue Stellata renders. Every row in the subset
carries at least one classical designation (proper name, Bayer,
Flamsteed, HIP, HD, HR, or Gliese).

```
athyg_33_classic_ids.csv   ~64 MB, LFS. ~313k stars.
```

## Provenance

- **Maintainer**: David Nash, [Codeberg/astronexus/athyg](https://codeberg.org/astronexus/athyg).
- **Licence**: CC-BY-SA-4.0. The generated `public/catalog.bin` and
  `public/search-index.json` are derivatives and carry the same licence.
- **Composition**: heterogeneous merge over Tycho-2 (bulk positions
  + V_T photometry), Hipparcos (bright end), Gaia DR3 (most
  distances, some positions), Gliese (nearby stars). The classic-IDs
  subset is whichever merge rows carry one of the classical IDs above.
- **Per-row provenance**: `pos_src` / `dist_src` / `mag_src` / `pm_src`
  columns name which upstream catalogue supplied each piece of data.
  ~99.4 % Tycho-2 positions, ~97.9 % Gaia DR3 distances, mixed
  Tycho-2 / Hipparcos magnitudes. See `docs/science-catalog-ingestion.md`
  § Stellar catalog ingestion for the magnitude distribution and how it interacts with
  the `naked-eye` / `binoculars` / `all` presets.

## Consumed by

`scripts/catalog/build-catalog.ts` (`readStars` in
`scripts/catalog/stars-parse.ts`). The build does NOT consult the
network — refresh of this file is a manual swap, see
[`scripts/refresh/`](../../scripts/refresh/README.md) when a new
AT-HYG release lands. Reference epoch J2000.0; proper-motion columns
are ingested but not applied (no T-axis animation today).
