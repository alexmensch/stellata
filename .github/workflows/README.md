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

Standard CI test run on every PR: `pnpm run typecheck` + `pnpm test` +
`pnpm run build:catalog` (sanity check that the catalog pipeline still
parses). Required for merge.
