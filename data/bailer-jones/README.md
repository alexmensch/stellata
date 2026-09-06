# Bailer-Jones DR3 — Bayesian distance posteriors

Layer 1 of the multi-layer distance refinement stack — replaces the parallax
cascade's naïve `1 / π` Gaia inversion with well-calibrated Bayesian
posteriors. Targets the noisy low-S/N regime that hosts the
brightest, most luminous, longest-baseline stars (B/A supergiants,
AGB stars) where the inverse-parallax estimator catastrophically
fails.

```
bailer-jones-dr3.tsv   ~26 MB, LFS. Keyed by Gaia DR3 source_id.
                       365,762 rows.
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
[`scripts/catalog/catalog-pure.ts`](../../scripts/catalog/). Fires only when
the parallax cascade resolved **`gaia_dr3_inversion`** — the record's own DR3
parallax, which is the measurement this posterior treats — AND the B-J map
covers it. A record placed by Hipparcos, CNS5, Gliese, SIMBAD or a bound
sibling is excluded deliberately: regressing a non-Gaia parallax onto B-J's
Galactic-density prior discards a measurement for one computed from a
different, worse one. Coverage pins as `bjOverridden / bjEligible` in
`scripts/catalog/build-catalog-expected.json`. See
`scripts/catalog/distance/README.md` § Multi-layer distance refinement.

## Refresh

`pnpm run refresh:bailer-jones` →
[`scripts/refresh/refresh-bailer-jones.py`](../../scripts/refresh/README.md).
The request set is the membership manifest's `gaia_source_id` column
(`scripts/refresh/README.md` § Request sets are membership-derived); the pull
batches over it and checkpoints per batch, so `--force` resumes rather than
restarting.
