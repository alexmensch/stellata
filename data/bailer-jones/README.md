# Bailer-Jones DR3 — Bayesian distance posteriors

Layer 1 of the multi-layer distance refinement stack — replaces the parallax
cascade's naïve `1 / π` Gaia inversion with well-calibrated Bayesian
posteriors. Targets the noisy low-S/N regime that hosts the
brightest, most luminous, longest-baseline stars (B/A supergiants,
AGB stars) where the inverse-parallax estimator catastrophically
fails.

```
bailer-jones-dr3.tsv   ~95 MB, LFS. Keyed by Gaia DR3 source_id.
                       1,273,650 rows.
```

## Provenance

- **Citation**: Bailer-Jones C. A. L., Rybizki J., Fouesneau M.,
  Demleitner M., Andrae R. 2021, *AJ* 161, 147.
  DOI: [10.3847/1538-3881/abd806](https://doi.org/10.3847/1538-3881/abd806).
- **Table**: `external.gaiaedr3_distance` on the ESA Gaia archive — the
  archive's own copy of what VizieR publishes as `I/352/gedr3dis`, already
  on the paper's column names. § Why the pull is ESA-side.
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
`scripts/catalog/build-catalog-expected.json`, and the **shortfall between
them pins at zero** (`bjEligibleNotPulled`): an eligible record has its own
DR3 parallax, so this publication covers it, and an absence means this pull's
scope — § Refresh below — has moved since the table was pulled. See
[Multi-layer distance refinement](/scripts/catalog/distance/README.md#multi-layer-distance-refinement) and
§ Scope-derived pulls.

## Why the pull is ESA-side

The scope is the catalogue's deep population, whose larger half is defined by
a magnitude bound rather than by a list of ids
([The deep population](/scripts/refresh/magnitude/README.md#the-deep-population--a-bounded-leg-plus-a-request-leg)). Expressing that bound
takes a join against `gaiadr3.gaia_source`, and only the ESA archive hosts
both tables: VizieR's `I/352/gedr3dis` carries no magnitude column, so there
the same scope is 250 id batches and about five and a half hours against four
minutes of sliced join.

The two copies agree. Sampling 2,034 committed rows across the file against
ESA, 2,021 matched cell-for-cell and 13 differed — 12 in the last decimal
only (float32 rounding ties, ±0.001 pc, well inside the ±10% posterior
interval), and one where the VizieR-sourced file had written astropy's masked
repr `--` into an absent `r_med_photogeo` rather than an empty cell. 744 rows
carried that `--`; `parseBailerJonesTsv` reads it as NaN and falls back to
`r_med_geo`, which is what an empty cell does, so the encoding was invisible
to the build and is gone from the ESA-side write.

## Refresh

`pnpm run refresh:bailer-jones` →
[`scripts/refresh/refresh-bailer-jones.py`](../../scripts/refresh/README.md).
Two legs — every source at `G ≤ 11`, plus what the exported catalog request
adds below that floor — per [The deep population](/scripts/refresh/magnitude/README.md#the-deep-population--a-bounded-leg-plus-a-request-leg).
Runs AFTER `pnpm run build:astrometry-request`. Each leg checkpoints per
batch, so `--force` resumes rather than restarting.
