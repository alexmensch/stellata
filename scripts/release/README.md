# Release cutting

Turns a push to `main` into versioned GitHub releases, and gates the size
and the behaviour of what the deploy uploads. Release cutting is invoked
by `.github/workflows/deploy.yml` around its Cloudflare deploy; also
usable by hand (see [Manual release](/RELEASING.md#manual-release-fallback)).

- `release-plan-pure.ts` — the decision layer. `declarationOf()` reads
  the release level a PR's labels declare (`LEVEL_LABELS`: `release:major`,
  `release:minor`, `release:patch`, or `SKIP_LABEL`, `skip-version-bump`),
  as a variant that is `undeclared` or `conflicting` unless exactly one is
  on; `bumped()` applies a level; `planReleases()` derives every pushed
  commit's version ([Derived versions](#derived-versions));
  `extractReleaseNotes()` pulls the `## Release notes` section out of a
  PR body; `prNumberFromSubject()` reads the squash-merge `(#NN)` suffix.
  The version and tag grammar and `releaseAt()` are
  `../util/release-version.ts`, which the build reads too.
- `release-level.ts` (+ test) — the guards' level read: a PR's labels on
  stdin, one per line, out comes `major|minor|patch|none`, or a
  `::error::` and exit 1 unless exactly one level label is on. Run by
  `.github/actions/release-level`.
- `cut-releases.ts` — the CLI, three steps: `plan [--head] [--out
  <file>]` plans the releases up to `--head` and writes them as JSON (to
  `--out`, and with their count to `GITHUB_OUTPUT`); `tag` makes each
  planned release's annotated tag locally; `publish` creates each release,
  and with it its tag on origin. Both read the plan from `--plan <file>`,
  or without it from the `PLAN` environment variable, which is how
  `deploy.yml` hands on `plan`'s job output. `parsePlan()` refuses a
  malformed plan before either acts. Reads each commit's PR labels and
  body with `gh`. `publish`'s token: [The publish token](#the-publish-token).
- `asset-size-pure.ts` (+ test) — the Cloudflare Workers per-asset
  ceiling (`WORKERS_MAX_ASSET_BYTES`, 25 MiB) and `judgeAssetSizes()`,
  which ranks a file list largest first and splits out oversize and
  near-limit (over
  `ASSET_WARN_FRACTION`, 80 %). Its test also holds the catalogue's
  transport chunk plan (`/src/catalog-format/record/`) under that
  ceiling.
- `release-notes-check.ts` (+ test) — `release-notes-guard.yml`'s check:
  `node release-notes-check.ts <body-file>` fails unless
  `extractReleaseNotes()` finds the `## Release notes` section non-empty,
  so the guard and the deploy cannot disagree on what counts. Run by plain
  `node` (built-in TypeScript support, the `.nvmrc` Node in CI), as are
  `release-level.ts` and `cut-releases.ts`, which is why they and
  `release-plan-pure.ts` must import no package and no path that needs a
  bundler — the jobs check out `scripts/release` and `scripts/util` alone and
  install nothing. The test holds them to `node:` builtins, `./sibling.ts`
  imports and `../util/release-version.ts`, whose own test holds it to
  builtins.
- `pre-traffic-check.ts` — `deploy.yml`'s step between `wrangler versions
  upload` and `wrangler versions deploy`:
  [The pre-traffic check](#the-pre-traffic-check). Its verdicts are
  `pre-traffic-check-pure.ts` (+ test).
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
  `Deploy asset sizes` step, by `deploy.yml` before `wrangler versions upload`, and
  by `pnpm run deploy`.

## Derived versions

**No commit states its own version.** A PR declares a release *level* by
label, and the version is derived when it lands: which version a PR ships
depends on what lands before it. Two PRs in flight that each hand-picked
the next version would claim the same one, so the one landing second would
hit a version-file conflict in its sync with main and have to re-pick.

**The plan starts at the last release pushed, never at the push's
`before`.** Its base is the commit the newest release tag reachable from
HEAD was cut at (`releaseCommitAt`, `../util/release-version.ts`): the tags
on origin are the one record of what has shipped. A push's `before` is
not: GitHub keeps one pending run per concurrency group and cancels the
rest, and a failed deploy pushes no tag, so a range starting at `before`
would skip those commits for good and hand their version to the next PR.
**The plan is made once and handed on.** `plan` writes it as JSON and
`deploy.yml` hands it to `tag` and `publish`, which act on exactly the
releases `plan` printed: re-planned after `tag`, the base would be the
release this run just made, and a label edited mid-run would tag one thing
and publish another.

`planReleases()` walks that range oldest-first from the base's release
(`releaseAt(base)`). Each
commit's PR level bumps the version before it; `skip-version-bump` ships
nothing; a commit that already carries a release tag keeps it, so a rerun
over a released range re-derives nothing. A commit whose PR declares no
level, or two, stops the plan before any version past it is derived: the
guards make that unreachable for a PR that landed through the ruleset, and
a fix is a label edit and a rerun. **Only squash-merged PRs land on
`main`** ([Landing](../../RELEASING.md#landing)), and their subjects always
end `(#N)`; a commit without one (a push that bypassed the ruleset) stops
every later plan, and no label clears it.
Recover by tagging that commit by hand at the version it ships
(`git tag v<version> <sha> && git push origin v<version>`, the release
before it bumped by the level it deserves): it then reads as already
released.

**A run's range is not one commit.** It holds every commit since the last
release pushed — a cancelled or failed run leaves its commits to the next.
**Cloudflare is deployed once, at HEAD** (the code
that should be live), while **tags and releases are cut per releasing
commit** in the range. The two halves of "release"
answer different questions — what runs in production, versus what each
version shipped. `--first-parent` keeps the walk on `main`'s own line.

**The tags are made locally before the build and on origin after the
deploy.** The build's version is `releaseAt('HEAD')`, the newest release
tag reachable from HEAD, so `deploy.yml` runs `tag` first and the build,
the footer and the pre-traffic check all read the release being deployed.
A failed deploy discards the runner and its tags. Only `publish`, after
traffic has moved, puts a tag on origin, and only as part of creating its
release (`gh release create --target`), so origin never holds a release
tag without its page: a tag the next plan starts from has always been
published. The tags GitHub makes are lightweight, which `releaseAt` reads
the same (`describe --tags`).

### The publish token

**`publish` runs on a GitHub App token, never `GITHUB_TOKEN`.** A tag
`gh release create --target` makes at a commit whose `.github/workflows/`
files differ from `main`'s tip counts as a workflow update, which needs the
Workflows permission `GITHUB_TOKEN` can never hold: it answers HTTP 403,
"Resource not accessible by integration". A stack whose upper member edits
a workflow, or a workflow edit landing while an earlier deploy is queued,
puts a releasing commit there. `deploy.yml` mints the token in the step
before `publish`, scoped to Contents and Workflows write and Pull requests
read (the notes read each PR's body); the App and its secrets are in
[Required repository secrets](/RELEASING.md#what-the-deploy-workflow-does).
The workflow's own `GITHUB_TOKEN` is held at `contents: read`, so the App
token is the only writer. **The token and the App key live on a runner
that runs no dependency code**: mint and `publish` are their own job,
`publish-releases`, after `deploy`, which checks out only `scripts/release`
and `scripts/util` (credentials not persisted), sets up Node and installs
nothing — `cut-releases.ts` runs on `node:` builtins alone (above). The
plan reaches it as the `plan-releases` job's output. **The mint step references
`actions/create-github-app-token` by commit SHA, not a version tag**: it
is handed the App's private key, which can rewrite workflows, and a tag
can be repointed at other code. Dependabot (`.github/dependabot.yml`)
proposes the pin's bumps, with every other action's, weekly, labelled
`skip-version-bump`. `deploy-workflow.test.ts` pins all of it:
`publish`'s `GH_TOKEN` is the mint step's output in the same job, the step
asks for those three permissions, its action is SHA-pinned, `GITHUB_TOKEN`
stays read-only, and the job needs `deploy`, uses only checkout,
setup-node and the mint action, names no package manager, and checks out
just those two folders.

## The pre-traffic check

**The uploaded version has to answer as this checkout says it should
before it takes traffic.** `deploy.yml` uploads the version without
deploying it (`wrangler versions upload`), runs this check against the
version's workers.dev preview URL, and only on a pass moves production to
it (`wrangler versions deploy`). A failure fails the job with the previous
version still live and nothing tagged. The preview URL sits outside the
`stellata.xyz` zone, so the zone's bot and firewall rules, which can
refuse requests from the GitHub runner's datacenter IPs, do not apply.
The origin is the first argument, required: the preview URL in
`deploy.yml`, a local origin for a dry run. The Worker never reads the
request's host, and redirects are judged by path and query alone
(`locationPath`), so every origin answers alike. It asserts:

- every case in `src/routing-cases-fixture.ts`, replayed as a browser
  navigation — the same table `route`, the Worker and the dev server run,
  so the deployed Worker and its static files cannot drift from it
  unseen;
- `/app` is the application document (`APP_DOCUMENT_MARKER`) and its module
  entry script answers 200 as JavaScript — the miss a 404 fallback page
  would otherwise hide;
- `catalog.bin.0` answers with the catalogue's own header, read by the
  catalogue's reader, so an HTML body or a stale binary fails;
- the homepage footer shows `releaseAt()`, the release being deployed.

What the `stellata.xyz` zone adds on top — its own rules, caching and the
custom-domain binding — is outside the check;
[After a release](/RELEASING.md#after-a-release) is the manual look at it.

**Requests go over a raw socket** (`raw-get.ts`), because `fetch` drops the
`Sec-Fetch-Mode` header the share-link routing depends on. **The whole
check retries** — twelve runs five seconds apart — because the edge takes a
few seconds to serve a new deploy; only the last run's failures are
reported, followed by the first failing answer's status and its
`cf-mitigated` / `server` / `cf-ray` headers (`EDGE_HEADERS`), which tell a
Cloudflare block or challenge from the Worker's own answer. It is never
run by hand against production as a test: its pure half has the suite,
and a dry run points it at a local origin or at an uploaded version's
preview URL.

## Invariants

- **Idempotent by release, not by tag.** A rerun skips any tag that
  already has a *release*; a tag that exists without one still gets its
  release created. Checking the tag instead would strand a run that
  died between `git push` and `gh release create`.
- **`--latest` goes to the newest planned release only.** Back-filling
  older versions must not move the repo's "Latest" pointer backwards.
- **A missing notes section is not an error.** Falls back to
  `--generate-notes`.

`plan` prints the plan — which tags, at which commits, from which PRs —
and touches nothing. Use it before any manual invocation.
