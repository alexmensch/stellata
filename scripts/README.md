# Scripts — build pipeline

Per-pipeline subfolders own their content. This file carries only
cross-script policy and pointers.

## Subfolders

- `catalog/` — single-star catalog build → `public/catalog.bin.<i>`
  transport chunks + `public/catalog-manifest.json` (+
  `build/catalog-row-index-map.json`; companions promoted from
  `data/binaries/multiples.tsv` ride catalog.bin as first-class
  records with `FLAG_BINARY_COMPANION_ONLY` set). The chunks are a
  byte-range split of the v9 binary that keeps every deployed asset
  under Cloudflare Workers' 25 MiB limit; see `catalog/record/README.md`
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
- `milkyway-calibration/` — the resolved catalogue measured against the
  Milky Way band model off a built `catalog.bin`
  (`pnpm run measure:band-resolved`): the Leinert cap rows and the
  resolution-hole table, written as one generated module into
  `src/client/milkyway/calibration/`. Not part of the build.
- `release/` — `deploy.yml`'s release step: plans and cuts one tag +
  GitHub release per version bump in a pushed range (a merged stack is
  one push carrying several). Not part of `pnpm run build`.
- `sid/` — SID registry tools: `sid:allocate` (the only writer of
  `data/sid/ledger.tsv`), DR-churn risk-set export, DR reconciliation
  classifier, and `sid:stamp` (stamps sids onto clouds.json /
  local-group.json). The catalog build resolves stellar sids in-record
  from the ledger. See `docs/sid.md`.
- `perf/` — the human-armed headless perf runner (`pnpm run perf`):
  drives `debug.priceFrame()` in Playwright Chromium at the canon
  vantages and prints the differential table. Clocks only, never a
  pixel; launches only past the operator's `.perf-go` marker
  (`hooks/perf-guard.sh`). Not part of `pnpm test` or the build.
- `hooks/` — Claude Code guard hooks (PreToolUse / SessionStart).
- `clouds/`, `cloud-surfaces/`, `dust/`, `local-group/`,
  `local-bubble/`, `textures/` — per-layer build helpers.
  `local-bubble/` turns the Zucker 2022 inner-surface HEALPix map into
  `public/local-bubble.bin` (shell mesh), cross-checked against the
  Edenhofer dust grid; `cloud-surfaces/` traces per-cloud isosurface
  meshes from the Edenhofer posterior (offline, LFS-committed).

## What ships

Vite copies every file in `public/` into `dist/`, and `wrangler deploy`
uploads all of `dist/`. So `public/` holds only what the client fetches.
A hand-off between build stages that no client code reads —
`catalog-row-index-map.json`, `binding-integrity-verdicts.tsv` — goes in
the gitignored `build/` instead, where it costs no deploy bytes and
counts against no asset limit.

Cloudflare Workers rejects any single asset over 25 MiB
(`WORKERS_MAX_ASSET_BYTES`, `release/asset-size-pure.ts`).
`pnpm run check:asset-sizes` walks a built `dist/` against it; CI's
`deploy-asset-sizes` job runs it on every PR, so an oversize file fails
the PR, not the post-merge deploy.

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

## Building in a worktree

A fresh worktree has no `public/` artifacts — they are gitignored. Build them
there: `pnpm run dev` preprocesses and then serves, so starting the worktree's
dev server builds that worktree's artifacts, about a minute. `pnpm run build`
is the headless equivalent when no server is wanted, and Alex runs one dev
server per worktree, each on its own port. A missing `public/` is a setup step,
never a reason to route work back to the main checkout — not a perf run, not an
artifact-backed suite, not anything.

**Never symlink the main checkout's `public/` into a worktree.**
Artifact-backed suites self-skip without artifacts, and symlinking them in
makes those suites run — but then any build in the worktree writes *through*
the symlinks into the main checkout's `public/`, leaving it with artifacts that
disagree with each other. `tests/artifact-freshness.test.ts` exists to catch
exactly that mismatch. Want artifacts without a build? **Copy** them (`cp`), or
symlink and then materialise (`rm link && cp target link`) before any build.
Before running `build:catalog` or `build:binaries-runtime` in a worktree,
confirm nothing is a symlink: `find public -maxdepth 1 -type l`.

Repairing a clobbered main checkout: rebuild there, forcing past the mtime gate
above — `rm -f public/catalog-manifest.json` first, or `UPDATE_BUILD_COUNTS=1`.

One mtime side effect: a fresh worktree's LFS checkout of
`data/binaries/multiples.tsv` is newer than a symlinked `binaries.bin`, which
fails artifact-freshness until the mtimes are aligned (`touch -r`).
