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
  under Cloudflare Workers' 25 MiB limit; see [Binary catalog format](catalog/record/README.md#binary-catalog-format-publiccatalogbini--manifest).
  Also emits
  `public/constellation-boundaries.json` (IAU boundary arcs precessed to
  ICRS + the fade-quantile table; `catalog/boundaries/README.md`).
- `binaries/` — binary-system pipeline → `data/binaries/multiples.tsv`
  (two rows per physical pair, with sep+PA+epoch+Δmag columns) and
  `public/binaries.bin` (runtime artifact, one record per pair, for
  the `BinaryOrbitField` per-frame Kepler walk).
- `distance-validation/` —
  [Vaidman et al. 2025](/data/papers/index.md#vaidman2025) BA-supergiant
  cross-check.
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
  (`pnpm run measure:band-resolved`): the
  [Leinert et al. 1998](/data/papers/index.md#leinert1998) cap rows and the
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
- `ci/` — helpers only `.github/workflows/` runs: the catalogue build
  cache's key.
- `clouds/`, `cloud-surfaces/`, `dust/`, `local-group/`,
  `local-bubble/`, `textures/` — per-layer build helpers.
  `local-bubble/` turns the
  [Zucker et al. 2022](/data/papers/index.md#zucker2022) inner-surface
  HEALPix map into `public/local-bubble.bin` (shell mesh), cross-checked
  against the [Edenhofer et al. 2024](/data/papers/index.md#edenhofer2024) dust grid;
  `cloud-surfaces/` traces per-cloud isosurface meshes from the
  [Edenhofer et al. 2024](/data/papers/index.md#edenhofer2024) posterior (offline,
  LFS-committed).

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
`Deploy asset sizes` step runs it on every PR, so an oversize file fails
the PR, not the post-merge deploy.

## Preprocessor idempotency

`build:binaries`, `build:catalog` and `build:binaries-runtime` — together
`build:stamped` — skip on a **content-hash stamp**, never on mtimes. Each hashes every input it reads —
data tables, the SID registry, every non-test module under the script folders
it imports — and skips when that set matches `build/stamps/<step>.json` and
every output the stamp recorded still hashes the same. The stamp is cleared
before the build writes anything and rewritten only once the build's snapshot
asserts pass, so a failed or interrupted build always reruns. Hashing the
~1.1 GB input set plus ~100 MB of outputs costs about a second on a warm page
cache. Helpers: `util/build-stamp.ts`,
`util/build_stamp.py`.

An unchanged input invalidates nothing, so a rebuilt `multiples.tsv` with
identical content leaves the catalogue skipped. Forcing a rebuild: `--force`
on either Python step, `UPDATE_BUILD_COUNTS=1` on `build:catalog`, or delete
the stamp.

`build:clouds`, `build:local-group` and the `*-sync` mirrors — together
`build:mtime-gated` — are mtime-gated (size + mtime for the mirrors) and cost
seconds cold. `build:data` is `build:stamped` then `build:mtime-gated`.

## Building in a worktree

A worktree Claude Code creates starts with the main checkout's catalogue and
binaries artifacts plus their stamps: `.worktreeinclude` at the repo root
lists them, and the harness copies those gitignored files in at creation. The
stamps make the copy safe — when the worktree's inputs match what the main
checkout last built from, the dev server starts without rebuilding; when they
differ (main checkout built from an older commit, a pipeline change on the
branch), the stamp mismatches and the step rebuilds. Only stamped outputs
belong in that list: an mtime-gated step reads any fresh copy as up to date,
whatever it was built from. A worktree made any other way
(`git worktree add`) builds from scratch.

`pnpm run dev` preprocesses and then serves, so starting the worktree's dev
server builds whatever is missing or stale; a cold catalogue build takes about
six minutes. `pnpm run build` is the headless equivalent when no server is
wanted, and Alex runs one dev server per worktree, each on its own port. A
missing `public/` is a setup step, never a reason to route work back to the
main checkout — not a perf run, not an artifact-backed suite, not anything.

**Never symlink the main checkout's `public/` into a worktree.** Any build in
the worktree then writes *through* the symlinks into the main checkout's
`public/`, leaving it with artifacts that disagree with each other.
`tests/artifact-freshness.test.ts` exists to catch exactly that mismatch.
**Copy** artifacts, never link them. Before running `build:catalog` or
`build:binaries-runtime` in a worktree, confirm nothing is a symlink:
`find public -maxdepth 1 -type l`.

A clobbered main checkout repairs itself: its stamps record the outputs it
built, so the next build there sees them rewritten and rebuilds.

## Seeding builds — `build:seed`

`pnpm run build:seed` (`build-seed.sh`) runs `build:stamped` — exactly the
steps whose outputs seed a new worktree ([Building in a worktree](#building-in-a-worktree)) — with one
build per checkout. Each run registers `build/build-seed/<start ns>.<pid>`
before looking at the others, then stops every older live run and waits for it
to exit, or exits at once if a newer one is registered; so the newest run
builds and no two ever build at the same time, however many start together. A
stopped run takes its build's whole process group down (TERM, then KILL after
30 s) before exiting, and an entry whose process is gone is deleted on sight.
`scripts/build-seed.test.ts` pins all of this. The superseded run exits 0 with
`superseded by a newer build:seed`; any other exit is the build's own status.
Nothing is forced — the stamped step that was interrupted has no stamp and
reruns, every step that finished skips ([Preprocessor idempotency](#preprocessor-idempotency)). The
mtime-gated steps and the client are never run, so none is ever interrupted
mid-write. Only `build:seed` runs take part: a plain `pnpm run build` or
`pnpm run dev` in the same checkout is neither stopped nor seen.
