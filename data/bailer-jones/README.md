# Bailer-Jones DR3 — Bayesian distance posteriors

Layer 1 of the multi-layer distance refinement stack — replaces the parallax
cascade's naïve `1 / π` Gaia inversion with well-calibrated Bayesian
posteriors. Targets the noisy low-S/N regime that hosts the
brightest, most luminous, longest-baseline stars (B/A supergiants,
AGB stars) where the inverse-parallax estimator catastrophically
fails.

```
bailer-jones-dr3.tsv   ~95 MB, LFS. Keyed by Gaia DR3 source_id.
                       1,277,736 rows.
```

## Provenance

- **Citation**: [Bailer-Jones 2021](/data/papers/index.md#bailerjones2021).
- **Table**: `external.gaiaedr3_distance` on the ESA Gaia archive,
  `gaiaedr3_complements.distances` on ARI Heidelberg — the Gaia archives'
  copies of what VizieR publishes as `I/352/gedr3dis`, already on the paper's
  column names. [Why the pull is Gaia-side](#why-the-pull-is-gaia-side).
- **Columns ingested**: `source_id`, `r_med_photogeo`, `r_med_geo`.
  Photogeometric (`r_med_photogeo`) is preferred; geometric
  (`r_med_geo`) is the fallback when photogeo is absent.
- **Key type**: source_id is parsed as a **string** — Gaia DR3
  source_ids regularly exceed `Number.MAX_SAFE_INTEGER` and any
  numeric parse would silently corrupt the join.

## Consumed by

`scripts/catalog/build-catalog.ts` via
`applyBailerJonesOverride` in
[`scripts/catalog/distance/refinement/distance-overrides-pure.ts`](../../scripts/catalog/distance/refinement/). Fires only when
the parallax cascade resolved **`gaia_dr3_inversion`** — the record's own DR3
parallax, which is the measurement this posterior treats — AND the B-J map
covers it. A record placed by Hipparcos, CNS5, Gliese, SIMBAD or a bound
sibling is excluded deliberately: regressing a non-Gaia parallax onto B-J's
Galactic-density prior discards a measurement for one computed from a
different, worse one. Coverage pins as `placement.distance.bailer-jones` in
`scripts/catalog/build-catalog-expected.json`, and **an eligible record the
table lacks fails the build**, named by placement lineage's
`placement.distance.bailer-jones-absent` invariant: an eligible record has its own
DR3 parallax, so this publication covers it, and an absence means this pull's
scope — [Refresh](#refresh) below — has moved since the table was pulled. See
[Multi-layer distance refinement](/scripts/catalog/distance/refinement/README.md#multi-layer-distance-refinement) and
[Scope-derived pulls](/scripts/catalog/distance/refinement/README.md#scope-derived-pulls--why-the-zero-pin-is-here).

## Why the pull is Gaia-side

The scope is the catalogue's deep population, whose larger half is defined by
a magnitude bound rather than by a list of ids
([The deep population](/scripts/refresh/magnitude/README.md#the-deep-population--a-bounded-leg-plus-a-request-leg)). Expressing that bound
takes a join against `gaiadr3.gaia_source`, which only the Gaia archives host:
VizieR's `I/352/gedr3dis` carries no magnitude column, so there the same scope
is 250 id batches and about five and a half hours against minutes of sliced
join. Both Gaia mirrors host both tables, the Bailer-Jones one under different
names with the same eight columns, so the pull asks ESA and falls back to ARI
([The TAP backend](/scripts/refresh/pull/README.md#the-tap-backend));
[The deep population](/scripts/refresh/magnitude/README.md#the-deep-population--a-bounded-leg-plus-a-request-leg)
records the two copies' agreement.

## Refresh

`pnpm run refresh:bailer-jones` →
[`scripts/refresh/magnitude/refresh-bailer-jones.ts`](../../scripts/refresh/magnitude/README.md).
Two legs — every source at `G ≤ 11`, plus what the astrometry request
adds below that floor — per [The deep population](/scripts/refresh/magnitude/README.md#the-deep-population--a-bounded-leg-plus-a-request-leg).
Runs AFTER `pnpm run build:astrometry-request`. Every answered query is
checkpointed, so a failed run resumes rather than restarting
([The checkpoint](/scripts/refresh/pull/README.md#the-checkpoint)).
