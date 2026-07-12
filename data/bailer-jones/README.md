# Bailer-Jones DR3 — Bayesian distance posteriors

Layer 1 of the multi-layer distance refinement stack — replaces
AT-HYG's naïve `1 / π` Gaia parallax inversion with well-calibrated
Bayesian posteriors. Targets the noisy low-S/N regime that hosts the
brightest, most luminous, longest-baseline stars (B/A supergiants,
AGB stars) where the inverse-parallax estimator catastrophically
fails.

```
bailer-jones-dr3.tsv   ~23 MB, LFS. Keyed by Gaia DR3 source_id.
```

## Provenance

- **Citation**: Bailer-Jones C. A. L., Rybizki J., Fouesneau M.,
  Demleitner M., Andrae R. 2021, *AJ* 161, 147.
  DOI: [10.3847/1538-3881/abd806](https://doi.org/10.3847/1538-3881/abd806).
- **VizieR catalog**: `I/352/gedr3dis`.
- **Columns ingested**: `source_id`, `r_med_photogeo`, `r_med_geo`.
  Photogeometric (`r_med_photogeo`) is preferred; geometric
  (`r_med_geo`) is the fallback when photogeo is absent.
- **Key type**: source_id is parsed as a **string** — Gaia DR3
  source_ids regularly exceed `Number.MAX_SAFE_INTEGER` and any
  numeric parse would silently corrupt the join.

## Consumed by

`scripts/catalog/build-catalog.ts` via
`applyBailerJonesOverride` in
[`scripts/catalog/catalog-pure.ts`](../../scripts/catalog/). Fires
only when AT-HYG's `dist_src ∈ {G_R3, G_R2}` AND the row's
`gaia_source_id` resolves AND the B-J map covers it (~99.5 % of
Gaia-DR3-bearing AT-HYG rows). See SCIENCE.md § Multi-layer
distance refinement.

## Refresh

`pnpm run refresh:bailer-jones` →
[`scripts/refresh/refresh-bailer-jones.py`](../../scripts/refresh/README.md).
