# Scripts — build pipeline

Per-pipeline subfolders own their content. This file carries only
cross-script policy and pointers.

## Subfolders

- `catalog/` — single-star catalog build → `public/catalog.bin`.
- `binaries/` — binary-system pipeline → `data/binaries/multiples.tsv`.
- `distance-validation/` — Vaidman 2025 BA-supergiant cross-check.
- `refresh/` — Layer 2 external-catalogue refresh (manual,
  infrequent).
- `colour/` — blackbody → sRGB LUT generator.
- `clouds/`, `dust/`, `local-group/` — per-layer build helpers.

## Preprocessor idempotency

`scripts/catalog/build-catalog.ts isUpToDate` skips rebuild if `catalog.bin`,
`constellations.json`, **and** `search-index.json` are newer than all
source inputs (AT-HYG CSV, Stellarium JSON, GCVS files, Hipparcos
CCDM TSV, and the script itself). If you change field mapping but
not the script mtime (e.g. edit in a way that updates atime only),
you may need to `touch scripts/catalog/build-catalog.ts` or delete the
generated files.
