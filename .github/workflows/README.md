# CI workflows

GitHub Actions for Stellata's release + guard pipeline. The Cloudflare
Wrangler config that `deploy.yml` invokes lives at `wrangler.toml`
(repo root); deploy-relevant Wrangler policy is captured in that
file's inline comments.

## `deploy.yml`

Runs on push to `main`. Builds + `wrangler deploy`s **once, at HEAD**,
then hands off to `scripts/release/cut-releases.ts`, which cuts a tag
and a GitHub release for **every** commit in the pushed range whose
`package.json#version` differs from its predecessor — each carrying the
`## Release notes` block from its own PR body, in place of the flat
auto-generated notes.

One push can therefore ship several releases: merging a stack lands N
PRs as N commits in a single push event. The version comparison that
gates the deploy runs against `github.event.before`, not `HEAD~1`, so a
stack whose *tip* commit doesn't bump still deploys and still releases
its earlier bumps. Rationale and invariants: `scripts/release/README.md`.

The PR-body extraction is the reason `release-notes-guard.yml` exists
(below) — a missing block would land an empty release page.

Restores LFS content via the shared `.github/actions/lfs-cache`
composite action (same as the data-consuming jobs in `test.yml`)
rather than an `lfs: true` checkout, so a deploy reuses the cached
objects instead of pulling ~600 MB from the LFS store every push.

## `release-notes-guard.yml`

CI check on every PR. Fails the PR if the `## Release notes` block in
the PR body is empty (HTML comments don't count). Skipped on PRs
labelled `skip-version-bump`. See `RELEASING.md` for the block format.

## `perf-section-guard.yml`

CI check on every PR. Fails the PR unless the body carries a non-empty
`## Perf` section with an `accepted:` line for every `✗` row, whenever the
diff does either of:

- **touches a render path** — any `.ts` or `.wgsl` under
  `src/client/` outside the folders [Perf pin](/RELEASING.md#perf-pin) exempts;
- **moves catalogue membership by more than 1 %** — read as
  `recordCount` in `scripts/catalog/build-catalog-expected.json`, base
  against head. A membership change lands in `scripts/` and `public/`, so
  no path rule sees it, yet it moves how many instanced quads every star
  pass draws. The 1 % is `RECORD_COUNT_TOLERANCE`, the same bound
  `--against-pin` refuses a comparison past, and a test fails when the two
  drift apart — they have to agree, or a change under the trigger would
  ship a pin that refuses every row.

The check is `scripts/perf/perf-section-check.sh`, tested in vitest; CI has
no GPU, so it checks the section, never the numbers. The exempt list is
stated once, in `RELEASING.md`, and a test fails when the script drifts from
it. Counts unreadable on either side leave that half of the trigger silent —
the comparison-time refusal is the backstop.

## `version-guard.yml`

CI check on every PR. Fails the PR if `package.json#version` was bumped
inconsistently with the PR's contents — pure-docs PRs need
`skip-version-bump`; user-visible behaviour PRs need a bump. See
[Version policy](/RELEASING.md#version-policy).

## `test.yml`

CI pipeline on every PR (and push to `main`). Required for merge. A
fan-out of jobs beyond the bare checks:

- `lfs-data` — warms the shared LFS object cache
  (`.github/actions/lfs-cache`) once so the data-consuming jobs below
  restore ~600 MB from the Actions cache instead of each pulling from
  the LFS store.
- `typecheck` / `test` — `pnpm run typecheck` and `pnpm test`. The bare
  `test` job has no LFS content, so data-dependent suites self-skip
  there and run for real in the jobs below.
- `build-binaries` / `spotcheck` — rebuild `multiples.tsv` and assert it
  matches the committed artifact; resolve Stage 2 against the curated
  ground-truth corpus.
- `build-catalog` — the catalogue stage with its regenerate-and-diff
  gates, then `build:layers` (everything `pnpm run build` does after
  `build:catalog` except the client), then every check that reads the
  built artifacts, as named steps. On a pull request
  the catalogue stage (`build:classic-ids` through `build:catalog`, ~5 min)
  restores from a content-keyed cache when no input changed; key, cached
  set and the one way to get a stale hit: `scripts/ci/README.md`. The
  checks:
  - `SID ledger–artifact consistency` — `pnpm run sid:check`.
  - `Tier-A star corpus` — the known-stars corpus + render-geometry
    regression, and the LFS-gated catalogue-wide sweeps.
  - `Deploy asset sizes` — finishes the deploy build with
    `build:client` (`pnpm run build`'s one stage this job skips is
    `build:binaries`, pinned by `build-binaries`), then
    `pnpm run check:asset-sizes` over
    `dist/`: fails on any file past Cloudflare Workers' 25 MiB per-asset
    limit, warns past 80 % of it. `deploy.yml` runs the same check before
    `wrangler deploy`.

  Each check gates on `build:layers`, not on the others, so all report
  when one fails. They share the build's runner rather than downloading its
  output in jobs of their own: a job costs ~45 s of checkout, LFS
  restore and install before it starts, and here that setup would sit
  on the pipeline's critical path.
- `sid-ledger-guard` — append-only ledger guard, DR-reconciliation
  classifier, swap parity ledger.

Both LFS vitest runs take an explicit file list, so a `describe.skipIf`
suite no list names skips everywhere and reports green. Adding one means
adding it to the `Tier-A star corpus` step (needs built artifacts) or
`sid-ledger-guard` (needs committed LFS inputs only).

The `main` ruleset requires these jobs by display name
([Merge gating](/RELEASING.md#merge-gating)): renaming, merging or splitting a job
means updating the ruleset's required contexts in the same change.
