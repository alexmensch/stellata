# CI workflows

GitHub Actions for Stellata's release + guard pipeline. The Cloudflare
Wrangler config that `deploy.yml` invokes lives at `wrangler.toml`
(repo root); deploy-relevant Wrangler policy is captured in that
file's inline comments.

## `deploy.yml`

Runs on push to `main`. Its `plan-releases` job derives the version of
every commit since the newest release tag's commit
([why there](/scripts/release/README.md#derived-versions))
from its PR's release level label (`scripts/release/cut-releases.ts
plan`), and hands that plan to the `deploy` job's steps; a
range that ships no release stops there. Otherwise `deploy` makes those
release tags locally, builds — the build's version is the newest of them
— and deploys **once, at HEAD**: uploads the version (`wrangler versions
upload`), checks it on its preview URL, then moves traffic to it
(`wrangler versions deploy`) and applies `wrangler.toml`'s routes and
custom domain (`wrangler triggers deploy`). A failed check leaves the
previous version live and pushes no tag
([The pre-traffic check](/scripts/release/README.md#the-pre-traffic-check)).
Last, `cut-releases.ts publish` creates each GitHub release, and its tag
with it, carrying the `## Release notes` block from its own PR body in
place of the flat auto-generated notes.

The range can hold several releasing commits — a failed deploy leaves its
commit untagged for the next push's run — and each releases at its own
derived version. Rationale and invariants:
[Derived versions](/scripts/release/README.md#derived-versions).

The PR-body extraction is the reason `release-notes-guard.yml` exists
(below) — a missing block would land an empty release page.

Restores LFS content via the shared `.github/actions/lfs-cache`
composite action (same as the data-consuming jobs in `test.yml`)
rather than an `lfs: true` checkout, so a deploy reuses the cached
objects instead of pulling ~600 MB from the LFS store every push.

## The PR a guard judges

Each guard runs on `pull_request`, takes the PR's number from the event and
reads its labels and body live through `gh`, never the event payload
([why](/RELEASING.md#merge-gating)). A stack member whose base is
another stack branch is judged too, on events that fire once it is in
the stack ([Landing](/RELEASING.md#landing)).

## The release level, and the `skip-version-bump` exemption

`.github/actions/release-level` reads the PR's labels live and fails
unless exactly one release level label is on —
`release:major`, `release:minor`, `release:patch` or `skip-version-bump`
(`scripts/release/release-level.ts`). `version-guard` is that check alone;
`release-notes-guard` gates every step after it on the level not being
`none`, so a `skip-version-bump` PR passes without its notes checked.

## `release-notes-guard.yml`

CI check on every PR. Fails it if the
`## Release notes` block in the PR body is empty (HTML comments don't
count); the body is read live from the PR. Exempt under
[the `skip-version-bump` exemption](#the-release-level-and-the-skip-version-bump-exemption).
See `RELEASING.md` for the block format.
The check is `scripts/release/release-notes-check.ts`, run by plain `node`, tested in vitest.

## `perf-section-guard.yml`

CI check on every PR, reading the body live and the diff against
`origin/<base branch>`.
Fails it unless the body carries a non-empty
`## Perf` section with an `accepted:` line for every `✗` row — and, when
the section claims Tier 1 or 2, at least one `--against-pin` table row —
whenever the diff does either of:

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

The check is `scripts/perf/perf-section-check.sh`, run through
`scripts/perf/perf-section-guard.sh`, which reads the changed files and
both record counts from git; both tested in vitest. CI has
no GPU, so it checks the section, never the numbers. The exempt list is
stated once, in `RELEASING.md`, and a test fails when the script drifts from
it. Counts unreadable on either side leave that half of the trigger silent —
the comparison-time refusal is the backstop.

Both body guards also run locally, before `gh pr create|edit --body-file`
sends the body: [How pr-body-guard works](/scripts/hooks/README.md#how-pr-body-guard-works).

## `version-guard.yml`

CI check on every PR. Fails it unless the PR
carries exactly one [release level](#the-release-level-and-the-skip-version-bump-exemption),
the level `deploy.yml` derives its version from. Which level is
[the version policy](/RELEASING.md#version-policy) and
[the live-app consumer test](/RELEASING.md#the-live-app-consumer-test). The
job keeps its `version-guard` name, the ruleset's required context.

## `cache-cleanup.yml`

Runs when a pull request closes, merged or not, and deletes every Actions
cache entry scoped to it (`refs/pull/<n>/merge`): its saved data builds
([The data build cache](/scripts/ci/README.md#the-data-build-cache)) and
anything else its runs saved. No other run can restore them, and the
repository's cache store evicts least-recently-used entries past its cap,
main's builds among them.

## `test.yml`

CI pipeline on every PR and push to `main`. Required for merge. A
fan-out of jobs beyond the bare checks:

- `lfs-data` — warms the shared LFS object cache
  (`.github/actions/lfs-cache`) once so the data-consuming jobs below
  restore ~600 MB from the Actions cache instead of each pulling from
  the LFS store.
- `typecheck` / `test` — `pnpm run typecheck` and `pnpm test`. The bare
  `test` job has no LFS content, so data-dependent suites self-skip
  there and run for real in the jobs below.
- `python-tests` — every `scripts/**/*.test.py`, failing on any skip
  ([Python suites](/scripts/ci/README.md#python-suites)). Every job that
  runs Python — this one, `test` (the runner and code-identity suites spawn
  `python3`), `spotcheck`, `build-catalog` and
  `deploy.yml`'s — sets it up from the repo-root `.python-version`,
  never the runner image's `python3`, so an image upgrade cannot move it.
- `spotcheck` — resolves Stage 2 against the curated ground-truth corpus.
- `build-catalog` — checked out with full history, which the SID
  ledger's append-only guard reads for its merge-base. `build:data
  --verify-committed` (every build step on the table, failing on any
  committed output the build moves: a SID mint the PR did not commit, a
  stale `multiples.tsv`, either astrometry request), then every check that
  reads the built artifacts, as named steps. A pull request restores
  a saved build and rebuilds only the steps whose stamps moved; a push
  to `main` rebuilds everything: [The data build cache](/scripts/ci/README.md#the-data-build-cache).
  The checks:
  - `Full vitest, smudged and built` — `pnpm test` again, now with LFS
    content and every built artifact present, so each suite that
    self-skips in the bare `test` job runs here: the known-stars corpus,
    the render-geometry regression and every LFS-gated sweep among them.
    Any test that skips here fails the step
    ([Vitest with every input](/scripts/ci/README.md#vitest-with-every-input)).
  - `Deploy asset sizes` — finishes the deploy build with
    `build:client`, then
    `pnpm run check:asset-sizes` over
    `dist/`: fails on any file past Cloudflare Workers' 25 MiB per-asset
    limit, warns past 80 % of it. `deploy.yml` runs the same check before
    `wrangler versions upload`.

  Each check gates on `build:data`, not on the others, so all report
  when one fails. They share the build's runner rather than downloading its
  output in jobs of their own: a job costs ~45 s of checkout, LFS
  restore and install before it starts, and here that setup would sit
  on the pipeline's critical path.

**No workflow edit adds a suite.** A new `describe.skipIf` vitest suite
runs smudged in `build-catalog` whatever it gates on, and a new
`*.test.py` runs in `python-tests`; in both, a skip fails the job. The cost is every data-free test
running twice, once per job, which buys that no list exists to
fall out of step.

The `main` ruleset requires these jobs by display name
([Merge gating](/RELEASING.md#merge-gating)): renaming, merging or splitting a job
means updating the ruleset's required contexts in the same change.
