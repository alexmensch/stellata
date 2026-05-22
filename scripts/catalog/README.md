# Catalog build

Single-star catalogue build pipeline: AT-HYG + GCVS + CCDM +
Bailer-Jones + Gaia Apsis + SIMBAD sp_type + Stellarium →
`public/catalog.bin` (v6 binary) + `public/constellations.json` +
`public/search-index.json`. Run via `npm run build:catalog`.

See `scripts/README.md` for the deep narrative — binary catalog
format, search index, Stellarium HIP resolution, physical radius +
spectral parsing, geometric binary inference, GCVS / CCDM cross-match,
multi-layer distance refinement, Gaia DR3 Apsis surfacing, reference
epoch + proper motion contract, idempotency.

## Validation harness

Three tiers live in this folder:

- **Tier A**: `known-stars.tsv` — ~50 hand-curated systems with
  per-component HIP / Gaia source_id / distance ± 1σ / absmag /
  spectral type tuples. Asserted against the built `catalog.bin` +
  `data/binaries/multiples.tsv` by `known-stars.test.ts`.
- **Tier B**: `build-counts.ts` + `build-catalog-expected.json` —
  per-tier count snapshot (`UPDATE_BUILD_COUNTS=1` to refresh).
  Catches population-mix shifts across rebuilds.
- **Tier C**: `validate-simbad-sample.ts` — cross-check the built
  `catalog.bin` against the committed SIMBAD random 10k sample
  (`data/simbad/simbad_sample.tsv`). Manual run
  (`npm run validate:simbad`). Acceptable-outlier set pinned in
  `build-distance-outliers-expected.json`
  (`UPDATE_DISTANCE_OUTLIERS=1` to refresh; hand-edited `reason`
  strings survive via `mergeReasonsFromSnapshot`).
