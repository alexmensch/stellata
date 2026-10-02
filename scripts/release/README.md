# Release cutting

Turns a push to `main` into GitHub releases, and gates the size of what
the deploy uploads. Release cutting is invoked by
`.github/workflows/deploy.yml` after a successful Cloudflare deploy;
also usable by hand (see [Manual release](/RELEASING.md#manual-release-fallback)).

- `release-plan-pure.ts` — the decision layer. `planReleases()` walks a
  push range oldest-first and emits one release per version change;
  `extractReleaseNotes()` pulls the `## Release notes` section out of a
  PR body; `prNumberFromSubject()` reads the squash-merge `(#NN)` suffix.
- `cut-releases.ts` — the CLI. Resolves the range with `git`, plans,
  then tags and publishes with `gh`.
- `asset-size-pure.ts` (+ test) — the Cloudflare Workers per-asset
  ceiling (`WORKERS_MAX_ASSET_BYTES`, 25 MiB) and `judgeAssetSizes()`,
  which ranks a file list largest first and splits out oversize and
  near-limit (over
  `ASSET_WARN_FRACTION`, 80 %). The catalogue chunk plan's test imports
  the same ceiling.
- `release-notes-check.ts` (+ test) — `release-notes-guard.yml`'s check:
  `node release-notes-check.ts <body-file>` fails unless
  `extractReleaseNotes()` finds the `## Release notes` section non-empty,
  so the guard and the deploy cannot disagree on what counts. Run by plain
  `node` (built-in TypeScript support, Node 24 in CI), which is why it and
  `release-plan-pure.ts` must import no package and no path that needs a
  bundler — the job checks out `scripts/release` alone and installs nothing.
  The test holds both to `node:` builtins and `./sibling.ts` imports.
- `post-deploy-check.ts` — `deploy.yml`'s step after `wrangler deploy`:
  [The post-deploy check](#the-post-deploy-check). Its verdicts are
  `post-deploy-pure.ts` (+ test).
- `version-upload.ts` — `deploy.yml`'s step after `wrangler versions
  upload`: reads wrangler's output file (`WRANGLER_OUTPUT_FILE_PATH`) and
  sets the step outputs `version_id` and `preview_url`. The parse is
  `version-upload-pure.ts` (+ test), which throws rather than hand on an
  empty ID or URL.
- `raw-get.ts` — a GET over a raw socket, shared with
  `src/worker-assets-layer.test.ts`.
- `check-asset-sizes.ts` — `pnpm run check:asset-sizes`. Walks `dist/`,
  prints the largest files, emits GitHub `::warning::` / `::error::`
  annotations and exits 1 on any oversize file. Run by `test.yml`'s
  `Deploy asset sizes` step, by `deploy.yml` before `wrangler deploy`, and
  by `pnpm run deploy`.

## One deploy, N releases

**A push is not a commit.** GitHub's merge-a-stack feature lands every
PR in a stack as its own commit in a *single* push event, and each of
those commits can carry its own `package.json` bump. Comparing HEAD to
HEAD~1 therefore sees only the top of the stack and silently drops
every intermediate version's tag, release, and release notes.

The split that resolves it: **Cloudflare is deployed once, at HEAD**
(that is the code that should be live), while **tags and releases are
cut per bumped commit** across `github.event.before..HEAD`. The two
halves of "release" answer different questions — what runs in
production, versus what each version shipped.

`--first-parent` keeps the walk on `main`'s own line, so a merge
commit's incoming branch never contributes phantom version changes.

## The post-deploy check

**The live site has to answer as this checkout says it should**, and a
failure fails the deploy job ahead of tagging, so a deploy that answers
wrongly is never released. Against `https://stellata.xyz` (`SITE_ORIGIN`;
a first argument overrides it), it asserts:

- every case in `src/routing-cases-fixture.ts`, replayed as a browser
  navigation — the same table `route`, the Worker and the dev server run,
  so production cannot drift from it unseen;
- `/app` is the application document (`APP_DOCUMENT_MARKER`) and its module
  entry script answers 200 as JavaScript — the miss a 404 fallback page
  would otherwise hide;
- `catalog.bin.0` answers with the catalogue's own header, read by the
  catalogue's reader, so an HTML body or a stale binary fails;
- the homepage footer shows `package.json`'s version, the one being
  deployed.

**Requests go over a raw socket** (`raw-get.ts`), because `fetch` drops the
`Sec-Fetch-Mode` header the share-link routing depends on. **The whole
check retries** — twelve runs five seconds apart — because the edge takes a
few seconds to serve a new deploy; only the last run's failures are
reported. It is never run by hand against production as a test: its pure
half has the suite, and a dry run points it at a local origin.

## Invariants

- **Idempotent by release, not by tag.** A rerun skips any tag that
  already has a *release*; a tag that exists without one still gets its
  release created. Checking the tag instead would strand a run that
  died between `git push` and `gh release create`.
- **`--latest` goes to the newest planned release only.** Back-filling
  older versions must not move the repo's "Latest" pointer backwards.
- **A missing notes section is not an error.** Falls back to
  `--generate-notes`, which is what a `skip-version-bump` PR merged
  alongside bumped siblings will hit.

`--dry-run` prints the plan — which tags, at which commits, from which
PRs — and touches nothing. Use it before any manual invocation.
