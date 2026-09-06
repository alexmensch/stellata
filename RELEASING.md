# Releasing

Stellata uses [Semantic Versioning](https://semver.org/). Each tagged
release is its own changelog — the GitHub release page is populated
from a `## Release notes` section in the merging PR's body. There is
no separate `CHANGELOG.md`.

Releases are cut automatically by `.github/workflows/deploy.yml`:
a push to `main` that changes `package.json#version` triggers a build
and a `wrangler deploy` at HEAD, then a `v<version>` tag and a GitHub
release for **each** bumped commit in the push. PRs that bump the
version therefore release on merge — including every PR in a merged
stack, which lands as several commits in one push. The work below is
mostly about getting the bump *and the release notes section* right on
the PR.

## Release notes per PR

The PR template (`.github/pull_request_template.md`) carries a
`## Release notes` block. Fill it with user-facing prose for the
version this PR ships — sub-headings for *Summary*, *New features*,
*Bugfixes*, and *Changes* (drop ones that don't apply).

The `release-notes-guard` workflow
(`.github/workflows/release-notes-guard.yml`) fails any PR whose
body lacks a non-empty `## Release notes` section (HTML comments are
stripped before the check, so the empty template doesn't pass).
Pure metadata PRs that attach `skip-version-bump` are exempt — they
don't ship a release.

When the deploy workflow runs, it parses each releasing commit's
squash subject for the merged PR number, fetches that body via `gh pr
view --json body`, extracts the `## Release notes` section, and passes
it to `gh release create`. If the section can't be found (non-squash
merge, body fetch fails) it falls back to GitHub's `--generate-notes`.

Notes are per PR, not per push: a stack of six bumping PRs merged
together produces six release pages, each with its own author's prose.

## Version policy

- **Major** — incompatible changes to the URL state format, the
  binary catalogue layout, the Worker route, or anything else that
  breaks bookmarks / saved links.
- **Minor** — new user-visible features (rendering modes, overlays,
  data sources), backward-compatible.
- **Patch** — bug fixes, copy tweaks, dependency bumps with no
  user-visible behaviour change.

Bump `package.json` on every PR so the version on `main` is always
the *next* release. Cutting a release is then just merging — the
deploy workflow handles tag, GitHub release, and Cloudflare deploy.

The `version-guard` workflow (`.github/workflows/version-guard.yml`)
runs on every PR and asserts:

1. `package.json#version` is strictly greater (per semver) than the
   base branch's version.
2. The new version is not already a published git tag.

Concurrent PRs can't silently both claim the same bump: whichever
merges second fails the guard until rebased and re-bumped. Pure
metadata PRs (e.g. `bd` issue-sync, no shipped code, CI workflow
edits) can attach the `skip-version-bump` label to opt out — use
sparingly. PRs without a bump don't redeploy.

### What "no user-visible behaviour change" actually means

"Patch" reads as the floor for any code change, but it isn't:
internal pipeline / build-script / tooling work whose output is **not
yet wired into the live deployed app** is a `skip-version-bump`, not
a patch. The bump rides the PR that wires new code into the live
consumer, not the PR that adds new code in isolation.

At commit time, ask: **does merging this PR change anything the
deployed site surfaces by the next push to main?** If no (data
pipeline output unused by current `build-catalog.ts` /
`catalog-loader.ts`; refresh-script work producing a TSV the build
doesn't yet read; CI / tooling / internal docs; partial multi-stage
rewrites mid-stream):

1. Do NOT bump `package.json#version`.
2. Attach the `skip-version-bump` label (`gh pr edit <N> --add-label
   skip-version-bump`).
3. `release-notes-guard` skips the `## Release notes` check when the
   label is on, so the section is optional for pure no-bump PRs.

When the wiring lands (a later stage wires earlier-stage output into
the build → new binary version), **that** PR carries the bump for
whichever semver tier the cumulative user-visible change deserves.

Multi-bead PRs that mix internal pipeline work with one user-visible
change: the user-visible change drives the bump tier. Pipeline PR
that ALSO touches a renderer knob → bump. Pipeline PR that only
touches scripts / data files unused by the deployed bundle → skip.

## Perf pin

The cost of a render change is a merge-time fact, not an audit finding.
The pin is a committed summary of the headless perf runner's whole-frame
readings — `scripts/perf/pins/<adapter-slug>.json`, one file per GPU, the
current pin only — and every PR that touches a render path diffs against
it and re-takes it. Design record: stellata-8cg.49.11; tooling:
stellata-8cg.49.12.

**What is pinned.** `--mode dwell` at the five canon vantages (sol, earth,
mw50, mw120, lg), 1280×800 at dpr 2 (4.096 Mpx), 240 frames, `raf-delta`,
exposure pinned. Every row records the wall p50 / p90 and, on WebGPU, the
GPU-stream p50. The per-pass differential is attribution, run when a row
moves or when the PR touches a pass directly; it explains a mark and never
fails one.

**The GPU-stream p50 is the only number that gates.** It is the one
continuous whole-frame reading the pin holds — the middle half of a canon
row spans 0.03–0.36 ms. Wall time is quantised to the display's refresh
interval, so every canon row's wall p50 reads 16.7–17.5 ms with a
middle-half spread of a whole interval, and its median turns on whether
50.1 % or 49.9 % of the frames made the deadline: wall is recorded, never
marked. A row carrying no GPU stream is recorded and not gated — every
WebGL2 row, since the backend supplies no such clock, and any WebGPU row
whose adapter resolves no believable durations. The cutover
(stellata-0it.13) leaves only gated rows behind.

**Taken cold, always.** Apple-silicon GPUs enter a sustained-load power
state after roughly 2–2.5 min of continuous frames, and rows either side
of that transition never compare (stellata-0it.38). A pin run is one
launch with an idle cool-down between contexts, and every context carries
a state-guard verdict — a dwell whose quarter medians trend one way by
more than 1 ms is refused by name. Two runs compare only on the same
adapter slug, buffer, method and state.

**What a mark means.** A row is `✗` when its GPU-stream p50 moves past the
`--baseline` band *and* past `max(0.5 ms, 3 %)` of the pinned value, or
when it crosses the ceiling — 33.4 ms of GPU-stream p50 at any canon
vantage, two 60 Hz intervals of hardware time — whatever the band says.
mw50 at 31.451 is the nearest row today, 1.9 ms under. `✓` is cheaper,
`~` is not resolved — not "no change".

**The 3 % floor is provisional.** It is three times a reproducibility
measured across three runs on 2026-09-05, none of which used a cool-down,
and against those same runs the first cold pin moves lg by 0.57–1.02 ms
where the floor allows 0.36 ms. stellata-8cg.49.17 re-derives it from the
spread between two cold pins — a second armed run, which is why it is not
the tooling bead; until it does, a `✗` carried by the floor alone is a
prompt to re-run rather than a verdict.

**The `## Perf` section.** Required in the PR body when the diff touches
anything under `src/client/` — `.ts`, `.glsl` and `.wgsl` alike — outside
`*.md`, `*.test.ts`, and the folders that neither draw nor decide what is
drawn: `calibration/`, `debug/`, `focus-card/`, `format/`, `hover/`,
`kinds/`, `loaders/`, `modals/`, `overlays/`, `poi/`,
`system-membership/`, `typeahead/`, `ui/`. **Naming what is exempt rather
than what is covered is the invariant**: a list of render folders exempts
by omission, so a layer folder added later escapes the gate until somebody
notices. `overlays/` is exempt because its per-frame work is SVG on the
CPU, which the gating clock does not see; `debug/` because the instrument
is not the frame. It carries the `--against-pin` table, the pin commit it
was read against, the adapter slug, the state-guard line per context, and
one `accepted: <row> <reason> (<bead-id>)` line per `✗`. The
`perf-section-guard` workflow fails the PR when the section is missing,
empty, or has a `✗` without an `accepted:` line — CI has no GPU, so it
checks the section the way `release-notes-guard` does — and the
`pr-review` skill refuses a render-path diff without it. There is no
skip label: a change that costs nothing shows a table of `~`.

**How the pin advances.** The re-taken pin is committed in the same PR, so
the pin always describes what the version bump deploys. A `✗` is fixed in
the PR or accepted with a bead; an accepted `✗` becomes the new pinned
value, and the ceiling is the only thing stopping accepted marks from
ratcheting the frame upward one PR at a time. Two render-path PRs in
flight re-take one file: whichever merges second rebases and re-takes,
the same way `version-guard` (§ Version policy) makes the second bump
rebase — and here that is another armed run, so check for an open
render-path PR before arming. A three bump or the cutover re-pins every
row under its own bead.

**Who runs it.** The agent, human-armed: one arm per pin run, the machine
idle throughout — about 15–25 min for the ten dwell contexts at a 120 s
cool-down, less as the cool-down is tuned down.

## Citation and archiving

Zenodo (CERN) archives every GitHub release through its GitHub integration
and mints a DOI for it — third-party, timestamped provenance that a
published record can only supersede, never edit or delete. Two kinds of
DOI come out of it:

- **Concept DOI** — `10.5281/zenodo.22392528`. Version-independent,
  always resolves to the newest release. This is the one to quote:
  README badge, README § Licence, `public/llms.txt`, `CITATION.cff`.
- **Version DOI** — one per release, cites that exact snapshot.
  v3.44.2, the first archived release, is `10.5281/zenodo.22392529`.

`CITATION.cff` at the repo root is the metadata Zenodo reads for each
record, and what GitHub's *Cite this repository* sidebar renders. Validate
edits with `cffconvert --validate -i CITATION.cff`.

What each record archives is the git tree at the tag — source. The
catalogue and rendered artifacts under `public/` are built from it, and the
LFS-tracked inputs under `data/` arrive as pointer stubs. That is the same
line README § Licence draws between this repository's AGPL-3.0-only code
and the third-party data licences.

**Invariant: GitHub's *Settings → Archives → Include Git LFS objects in
archives* stays off.** With it on, GitHub resolves all 1.1 GB of `data/`
into the source archive — v3.44.1 weighs 12 MB with it off, 656 MB with it
on — and every download of that archive, Zenodo's fetch included, bills the
account's Git LFS bandwidth quota. It also redistributes the third-party
`data/` inputs inside a record whose stated licence covers this
repository's code, erasing the line the paragraph above draws. Off, storage
is a non-issue at either end: Zenodo allows unlimited records under 50 GB
each, and ~2 releases a day of a 12 MB archive is under 1 GB a month.

**Record metadata stays editable; record files do not.** A published
record's title, abstract, authors and keywords can be edited at any time
without affecting its DOI; changing its files needs Zenodo support. A
stale abstract is therefore fixed in `CITATION.cff` — each release's record
is built from that file as it stood at the tag — and earlier records are
left as the snapshots they are, since the concept DOI resolves to the
newest. Adding a `.zenodo.json` makes Zenodo ignore `CITATION.cff`
entirely.

**A record's description is `CITATION.cff`'s abstract**, and its notes
field the file's `message`. Zenodo builds both from that file and ignores
the GitHub release body, so a release's `## Release notes` prose
(§ Release notes per PR) stays on its GitHub release page; the record
points there through the git tree at the tag it lists as a related
identifier.

`alexmensch/stellata` is connected in Zenodo's GitHub integration, so
every GitHub release is archived and gets a version DOI with no further
action. Archiving starts at v3.44.2, the release that minted both DOIs.

## Catalogue refresh policy

External catalogues (AT-HYG, Gaia DR3 cross-walks + 5p astrometry +
NSS + Apsis, Bailer-Jones DR3, Hipparcos-2 van Leeuwen, SIMBAD pulls)
are refreshed by manual `pnpm run refresh:*` invocations, **not** by
`pnpm run build` or the deploy workflow. The build reads the committed
files under `data/<source>/` and never hits the network — see
`data/README.md` § Frozen external data for the rationale.

**Cadence.** Refresh is event-driven, not scheduled. The trigger is an
upstream catalogue release:

- **Gaia DR transition** (DR3 → DR4 expected late 2026) — the largest
  refresh. Re-run every `refresh-gaia-*.py` script + `refresh-bailer-
  jones.py` in lockstep with the AT-HYG drop that re-keys to the new
  source_ids. Tier-A `known-stars.tsv` rows may need per-row source_id
  updates against the DR3↔DR4 cross-walk.
- **AT-HYG point release** — drop the new
  `data/athyg/athyg_3X_classic_ids.csv` in, rebuild, refresh the
  source_id-keyed side-files if AT-HYG's gaia coverage changed.
- **Bailer-Jones republication** — drop the new
  `bailer-jones-drN.tsv` in, rebuild. Runs independently of any other
  refresh; the override gate (`dist_src ∈ {G_R3, G_R2}`) is
  unchanged.
- **SIMBAD / Hipparcos-2** — refresh on demand; both are rolling
  catalogues and a sample-time anchor is fine for the validation tier.

The full refresh recipe + ordering constraints + post-refresh
validation steps are in `scripts/refresh/README.md` § Refreshing data when
DR4 / new AT-HYG lands.

**Version bump on catalogue refresh.** A catalogue refresh PR that
changes the user-visible scene (e.g. star count, per-star distance
distribution, new variable-star matches) bumps `package.json#version`
per § Version policy above — minor when the change is significant
(new layer / new ingest source / numerical drift visible at default
magnitude preset), patch when the refresh is mechanical and the diff
against `public/catalog.bin` is within the noise floor. Pure pipeline
internals that don't change the live binary (refresh that lands
data but doesn't wire it into `build-catalog.ts`) attach
`skip-version-bump`.

## Merge gating

Merge gating for `main` lives in a repo **ruleset**, not in classic
branch protection. `gh api repos/alexmensch/stellata/branches/main/protection`
404s; the ruleset is at
`gh api repos/alexmensch/stellata/rulesets/15843287`.

**The gotcha:** a required status-check *context* in the ruleset matches
a GitHub Actions job's display `name:`, not its job id. Renaming a job's
`name:` orphans the old required context, which then sits at "Expected /
Waiting for status to be reported" forever and blocks **all** merges,
even with every check green. A workflow-only fix can't self-merge — the
fix PR hits the same block.

- Renaming a required job's `name:` means updating the ruleset's
  required contexts in the same change. Fix the ruleset with `gh api
  --method PUT repos/alexmensch/stellata/rulesets/15843287 --input
  <payload>`, sending `name` / `target` / `enforcement` /
  `bypass_actors` / `conditions` / `rules`. Providing `rules` REPLACES
  the whole array, so preserve every existing rule type.
- To diagnose a stuck merge, compare the ruleset's required contexts
  against the reported CheckRun names: `gh pr view N --json
  statusCheckRollup`. The required set is the `test.yml` pipeline job
  display names plus `version-guard` — enumerate it live rather than
  trusting a written-down list.

## What the deploy workflow does

On every push to `main`, `deploy.yml`:

1. Compares `HEAD:package.json#version` against the version at the
   push's base commit (`github.event.before`, falling back to `HEAD~1`
   when that commit isn't in the clone). No change → exits silently.
2. Checks out with LFS, sets up Node 24 + Python 3, runs `pnpm install --frozen-lockfile`
   and `pnpm run build` (binaries + catalog + binaries-runtime +
   clouds + local-group + dust-sync + client).
3. Deploys to Cloudflare via `cloudflare/wrangler-action@v4` — once,
   at HEAD.
4. Runs `scripts/release/cut-releases.ts`, which walks the pushed range
   and, for each commit whose version differs from its predecessor's,
   pushes a `v<version>` tag at that commit and creates its release
   from that commit's own PR body. Falls back to `--generate-notes`
   where the section is missing, and skips any version already
   released.

Step 4 is what makes a merged stack correct: the base-commit
comparison in step 1 means the push still deploys when its tip commit
carries no bump, and the per-commit walk means no intermediate
version's notes are dropped. See `scripts/release/README.md`.

Required repository secrets:

- `CLOUDFLARE_API_TOKEN` — token scoped to: Account → Workers
  Scripts:Edit; Zone → Workers Routes:Edit + DNS:Edit (on the
  `stellata.xyz` zone, so wrangler can manage the proxied apex
  record from `wrangler.toml`'s `custom_domain = true`).
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account hosting the
  Worker.

## After a release

- Verify `https://stellata.xyz` serves the new version (visible at
  the bottom-right of the About modal).
- Bump `package.json` on the next PR to the version that release
  will carry.

## Manual release (fallback)

If the workflow needs to be bypassed (e.g. infrastructure outage):

```sh
pnpm run deploy
# Same planner the workflow uses: --dry-run first to see which tags
# it would cut, from which commits and PRs, then drop the flag.
pnpm exec tsx scripts/release/cut-releases.ts --base <base-sha> --dry-run
pnpm exec tsx scripts/release/cut-releases.ts --base <base-sha>
```

`--base` is the last commit that was already released; `--head`
defaults to `HEAD`. Already-released versions are skipped, so
re-running after a partial failure is safe. To back-fill releases the
workflow missed entirely, pass the tag it last cut as `--base`.
