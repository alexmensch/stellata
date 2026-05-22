# Scripts — build pipeline

Per-pipeline subfolders own their content. This file carries only
cross-script policy and pointers.

## Subfolders

- `catalog/` — single-star catalog build → `public/catalog.bin`. The
  binary format, search index, Stellarium ingestion, physical-radius +
  spectral parsing, GCVS / CCDM cross-match, distance refinement, and
  Apsis surfacing all live in `scripts/catalog/README.md`.
- `binaries/` — binary-system pipeline. Seven-stage WDS / Gaia / HIP2
  cross-match → `data/binaries/multiples.tsv`. See
  `scripts/binaries/README.md`.
- `distance-validation/` — Vaidman et al. 2025 BA-supergiant distance
  cross-check. See `scripts/distance-validation/README.md`.
- `refresh/` — Layer 2 external-catalogue refresh. Manual, infrequent.
  See `scripts/refresh/README.md`. The frozen-external-data policy
  itself lives in `data/README.md`.
- `colour/` — blackbody → sRGB LUT generator. Output:
  `src/client/star-pipeline/blackbody-lut-data.ts`. See
  `scripts/colour/README.md`.
- `clouds/`, `dust/`, `local-group/` — per-layer build helpers. Each
  layer's renderer + build script + data sit together in their own
  topic doc:
  - clouds → `src/client/molecular-clouds/README.md` (renderer is the
    canonical home; the build script is documented in
    `scripts/clouds/README.md`).
  - dust → `src/client/dust/README.md` + `scripts/dust/README.md`.
  - local-group → `src/client/local-group/README.md` +
    `scripts/local-group/README.md`.

## Preprocessor idempotency

`scripts/catalog/build-catalog.ts isUpToDate` skips rebuild if `catalog.bin`,
`constellations.json`, **and** `search-index.json` are newer than all
source inputs (AT-HYG CSV, Stellarium JSON, GCVS files, Hipparcos
CCDM TSV, and the script itself). If you change field mapping but
not the script mtime (e.g. edit in a way that updates atime only),
you may need to `touch scripts/catalog/build-catalog.ts` or delete the
generated files.
