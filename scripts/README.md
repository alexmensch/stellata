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
  under Cloudflare Workers' 25 MiB limit; see [Binary catalog format](../src/catalog-format/record/README.md#binary-catalog-format-publiccatalogbini--manifest).
  Also emits
  `public/constellation-boundaries.json` (IAU boundary arcs precessed to
  ICRS + the fade-quantile table; `/src/catalog-format/boundaries/README.md`).
- `binaries/` — binary-system pipeline → `data/binaries/multiples.tsv`
  (two rows per physical pair, with sep+PA+epoch+Δmag columns) and
  `public/binaries.bin` (runtime artifact, one record per pair, for
  the `BinaryOrbitField` per-frame Kepler walk).
- `distance-validation/` —
  [Vaidman 2025](/data/papers/index.md#vaidman2025) BA-supergiant
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
  [Leinert 1998](/data/papers/index.md#leinert1998) cap rows and the
  resolution-hole table, written as one generated module into
  `src/astro-core/milkyway/calibration/`. Not part of the build.
- `release/` — `deploy.yml`'s release steps: checks each uploaded version
  on its preview URL before it takes traffic, then plans and cuts one tag
  + GitHub release per
  version bump in a pushed range (a merged stack is one push carrying
  several). Not part of `pnpm run build`.
- `sid/` — SID registry tools: the allocation `build:catalog` runs over its
  records (the writer of the catalogue's registry partition,
  `data/sid/ledger.tsv` and `events.tsv`; `build:local-group` and
  `build:clouds` write their own), DR-churn risk-set export and DR
  reconciliation classifier. See `docs/sid.md`.
- `perf/` — the human-armed headless perf runner (`pnpm run perf`):
  drives `debug.priceFrame()` in Playwright Chromium at the canon
  vantages and prints the differential table. Clocks only, never a
  pixel; launches only past the operator's `.perf-go` marker
  (`hooks/perf-guard.sh`). Not part of `pnpm test` or the build.
- `site/` — what the public pages are derived from: the figures they
  quote (read by `vite.env.ts` at config load), the markdown rendition
  the site pass emits as `dist/index.md`, and the plugin that appends the
  citation index to a page's JSON-LD (`site/README.md`).
- `doc-figures/` — counts quoted in docs, generated from the committed
  `*-expected.json` snapshots (`pnpm run docs:figures`). Run it after any
  snapshot regeneration. Not part of the build.
- `hooks/` — Claude Code guard hooks (PreToolUse / SessionStart).
- `ci/` — helpers only `.github/workflows/` runs: the catalogue build
  cache's key.
- `pipeline/` — the step table and runner design: one model of which step
  writes which file, in what order, and when each is stale. Every build
  step runs through its runner.
- `clouds/`, `cloud-surfaces/`, `dust/`, `local-group/`,
  `local-bubble/`, `textures/` — per-layer build helpers.
  `local-bubble/` turns the
  [Pelgrims 2020](/data/papers/index.md#pelgrims2020) inner-surface
  HEALPix map into `public/local-bubble.bin` (shell mesh), cross-checked
  against the [Edenhofer 2024](/data/papers/index.md#edenhofer2024) dust grid;
  `cloud-surfaces/` traces per-cloud isosurface meshes from the
  [Edenhofer 2024](/data/papers/index.md#edenhofer2024) posterior (offline,
  LFS-committed).

## What ships

Vite copies every file in `public/` into `dist/`, and the deploy uploads
all of `dist/`. So `public/` holds only what the client fetches.
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

Every build step — the catalogue chain (`build:binaries`, `lineage:codes`,
the four generators `build:classic-ids`, `build:wgsn`,
`build:astrometry-request` and `build:membership`, `build:catalog` and
`build:binaries-runtime`), the two layer emitters `build:clouds` and
`build:local-group`, and the six `build:<layer>-sync` mirrors — runs
through the step table's runner ([pipeline/README.md](pipeline/README.md)):
each `package.json` target is `run.ts <step>`, which runs that step and every
step upstream of it in data-flow order, and skips each on a **content-hash
stamp**, never on mtimes. A stamp (`build/stamps/<step>.json`, written by the
runner alone) records every input the step read — for a TypeScript step its
esbuild import closure (`src/client/` modules included), the snapshots beside
it and every declared source it reads; for a
Python step every repo file the process opened, recorded as it ran — and every
output it wrote, and the step is fresh while both re-hash the same. The stamp
is cleared before the step runs and written only once it exits 0 with its
declared outputs in place, so a failed or interrupted build always reruns.
Unstamped families (the lineage baseline and diff) are never recorded. A
no-op `build:data` (all sixteen build steps fresh, every manual step checked)
takes about ten seconds on a warm page cache, measured 2026-11-04; the mirrors'
~0.5 GB of inputs and outputs are re-hashed within it.

An unchanged input invalidates nothing, so a rebuilt `multiples.tsv` with
identical content leaves the catalogue skipped. Forcing a rebuild:
`run.ts <step> --force`, which reaches every build step the run selects, or
delete the stamp. `--update-snapshots` reruns each named step even when fresh and rewrites
the count snapshots of every step it runs. `build:data` is `run.ts data`, every step on the table,
so a stale catalogue is rebuilt before the binaries read its row-index map.

## Building in a worktree

A worktree Claude Code creates starts with the main checkout's build
outputs under `public/` and `build/` (the mirrors' ~0.3 GB among them, by `du -ch` over their public/ outputs) plus
their stamps: `.worktreeinclude` at the repo root
lists them, and the harness copies those gitignored files in at creation. The
stamps make the copy safe — when the worktree's inputs match what the main
checkout last built from, the dev server starts without rebuilding; when they
differ (main checkout built from an older commit, a pipeline change on the
branch), the stamp mismatches and the step rebuilds. Only stamped outputs
belong in that list, since a stamp is what tells a copy apart from the
worktree's own build. The one other kind allowed is a diff baseline
that no step reads to decide whether to rebuild and that records what it was
built from — `build/lineage/`, whose header the lineage diff checks against
the merge-base ([The header and the refusal](catalog/lineage/baseline/README.md#the-header-and-the-refusal)).
Every listed file is an output of a step `build:seed` runs
([Seeding builds](#seeding-builds--buildseed)), so refreshing the main
checkout's seed is that one command. `worktree-seed.test.ts` holds each
pattern to a declared output or stamp of one of those steps, read from the
step table, and the converse: every such file, stamped output family or stamp under `public/`
or `build/` is listed, so nothing a stamp records can be missing from a fresh
worktree. The lineage baseline copies and diff are declared unstamped
(`stamped: false`) and never seeded, since a worktree pins its own baseline; a
stamp never records them, so their absence leaves the step fresh. A worktree
made any other way
(`git worktree add`) builds from scratch.

The private paper-store link is not in that list — the harness's copy skips
symlinks — and reaches every worktree through
[paper-store-link](hooks/README.md#how-paper-store-link-works) instead.

`pnpm run dev` preprocesses and then serves, so starting the worktree's dev
server builds whatever is missing or stale; a cold catalogue build takes about
six minutes. `pnpm run build` is the headless equivalent when no server is
wanted, and Alex runs one dev server per worktree, each on its own port. A
missing `public/` is a setup step, never a reason to route work back to the
main checkout — not a perf run, not an artifact-backed suite, not anything.

**Never symlink the main checkout's `public/` into a worktree.** Any build in
the worktree then writes *through* the symlinks into the main checkout's
`public/`, leaving it with artifacts that disagree with each other.
**Copy** artifacts, never link them. The runner refuses to load the step table
when a build step's declared output, or a folder above it, is a symlink, and
`tests/artifact-freshness.test.ts` catches the mismatch a write through a
link leaves.

A clobbered main checkout repairs itself: its stamps record the outputs it
built, so the next build there sees them rewritten and rebuilds.

## Seeding builds — `build:seed`

`pnpm run build:seed` (`build-seed.sh`) runs `build:data` — every build step
on the table, exactly the steps whose outputs seed a new worktree
([Building in a worktree](#building-in-a-worktree)) — with one build per
checkout. `build:membership` is among them, which keeps the main checkout holding the
lineage baseline a worktree diffs against.
Each run registers `build/build-seed/<start ns>.<pid>`
before looking at the others, then stops every older live run and waits for it
to exit, or exits at once if a newer one is registered; so the newest run
builds and no two ever build at the same time, however many start together. A
stopped run takes its build's whole process group down (TERM, then KILL after
30 s) before exiting, and an entry whose process is gone is deleted on sight.
`scripts/build-seed.test.ts` pins all of this. The superseded run exits 0 with
`superseded by a newer build:seed`; any other exit is the build's own status.
Nothing is forced — the step that was interrupted has no stamp and reruns,
every step that finished skips ([Preprocessor idempotency](#preprocessor-idempotency)).
A TypeScript step's outputs land all or none (`emitArtifacts`), so an
interrupted run leaves the previous set whole. On a dirty main membership's
lineage header records the edits and a branch's diff refuses that baseline
([The header and the refusal](catalog/lineage/baseline/README.md#the-header-and-the-refusal)). The
client is never run. Newest-run-wins covers `build:seed` runs only; a plain
`pnpm run build` or `pnpm run dev` in the same checkout is never stopped, and
the runner's per-step locks serialise it with a seed run step by step
([The runner](pipeline/README.md#the-runner--runts)).
