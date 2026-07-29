# Scripts — build pipeline

Per-pipeline subfolders own their content. This file carries only
cross-script policy and pointers.

## Subfolders

- `catalog/` — single-star catalog build → `public/catalog.bin.<i>`
  transport chunks + `public/catalog-manifest.json` (+
  `public/catalog-row-index-map.json`; companions promoted from
  `data/binaries/multiples.tsv` ride catalog.bin as first-class
  records with `FLAG_BINARY_COMPANION_ONLY` set). The chunks are a
  byte-range split of the v9 binary that keeps every deployed asset
  under Cloudflare Workers' 25 MiB limit; see `catalog/README.md`
  § Binary catalog format. Also emits
  `public/constellation-boundaries.json` (IAU boundary arcs precessed to
  ICRS + the fade-quantile table; `catalog/boundaries/README.md`).
- `binaries/` — binary-system pipeline → `data/binaries/multiples.tsv`
  (two rows per physical pair, with sep+PA+epoch+Δmag columns) and
  `public/binaries.bin` (runtime artifact, one record per pair, for
  the `BinaryOrbitField` per-frame Kepler walk).
- `distance-validation/` — Vaidman 2025 BA-supergiant cross-check.
- `refresh/` — Layer 2 external-catalogue refresh (manual,
  infrequent).
- `probes/` — JPL Horizons fetch for the five Sun-escape deep-space
  probes → `data/probes/*.json`, plus the `public/probes/` mirror.
  Fetch is manual (`pnpm run fetch:probes`); only the mirror runs in
  the build.
- `ephemerides/` — JPL Horizons fetch for the nine planet
  osculating-element tables → `data/ephemerides/*.json`, plus the
  `public/ephemerides/` mirror. Fetch is manual
  (`pnpm run fetch:ephemerides`); only the mirror runs in the build.
- `colour/` — blackbody → sRGB LUT generator.
- `sid/` — SID registry tools: `sid:allocate` (the only writer of
  `data/sid/ledger.tsv`), DR-churn risk-set export, DR reconciliation
  classifier, and `sid:stamp` (stamps sids onto clouds.json /
  local-group.json). The catalog build resolves stellar sids in-record
  from the ledger. See `docs/sid.md`.
- `clouds/`, `cloud-surfaces/`, `dust/`, `local-group/`,
  `local-bubble/`, `textures/` — per-layer build helpers.
  `local-bubble/` turns the Zucker 2022 inner-surface HEALPix map into
  `public/local-bubble.bin` (shell mesh), cross-checked against the
  Edenhofer dust grid; `cloud-surfaces/` traces per-cloud isosurface
  meshes from the Edenhofer posterior (offline, LFS-committed).

## Preprocessor idempotency

`scripts/catalog/build-catalog.ts isUpToDate` skips rebuild if
`catalog-manifest.json` (+ its first chunk), `constellations.json`,
`search-index.json`, `catalog-row-index-map.json`, **and**
`constellation-boundaries.json` all exist *and*
`catalog-manifest.json` is newer than all source inputs
(AT-HYG CSV, Stellarium JSON, GCVS files, Hipparcos CCDM TSV,
`data/binaries/multiples.tsv`, and the script itself) — the other four
are checked for existence only, since one build writes them all. If you change
field mapping but not the script mtime (e.g. edit in a way that
updates atime only), you may need to `touch
scripts/catalog/build-catalog.ts` or delete the generated files.
