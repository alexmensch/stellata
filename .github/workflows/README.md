# CI workflows

GitHub Actions for Stellata's release + guard pipeline. The Cloudflare
Wrangler config that `deploy.yml` invokes lives at `wrangler.toml`
(repo root); deploy-relevant Wrangler policy is captured in that
file's inline comments.

## `deploy.yml`

Runs on push to `main`. Builds + `wrangler deploy`s, then extracts the
`## Release notes` block from the merged PR's body and posts it to the
GitHub release for the version this push ships. Replaces the flat
auto-generated release notes with the PR-author-written block.

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

## `version-guard.yml`

CI check on every PR. Fails the PR if `package.json#version` was bumped
inconsistently with the PR's contents — pure-docs PRs need
`skip-version-bump`; user-visible behaviour PRs need a bump. See
`RELEASING.md` § Version policy.

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
- `build-catalog` — `build:catalog` + `build:clouds` +
  `build:local-group`, uploading `public/` as an artifact the jobs
  below consume.
- `sid-consistency` / `tier-a-corpus` — SID ledger↔artifact consistency
  and the Tier-A star corpus + render-geometry regression against the
  built artifacts.
- `sid-ledger-guard` — append-only ledger guard + DR-reconciliation
  classifier.
