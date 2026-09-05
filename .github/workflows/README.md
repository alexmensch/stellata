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

CI check on every PR. When the diff touches a render path (the globs in
`RELEASING.md` § Perf pin), fails the PR unless the body carries a
non-empty `## Perf` section with an `accepted:` line for every `✗` row.
The check is `scripts/perf/perf-section-check.sh`, tested in vitest; CI has
no GPU, so it checks the section, never the numbers.

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
- `sid-ledger-guard` — append-only ledger guard, DR-reconciliation
  classifier, swap parity ledger.

Both LFS jobs run an explicit file list, so a `describe.skipIf` suite no
list names skips everywhere and reports green. Adding one means adding it
to `tier-a-corpus` (needs built artifacts) or `sid-ledger-guard` (needs
committed LFS inputs only).
