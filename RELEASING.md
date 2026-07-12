# Releasing

Stellata uses [Semantic Versioning](https://semver.org/). Each tagged
release is its own changelog — the GitHub release page is populated
from a `## Release notes` section in the merging PR's body. There is
no separate `CHANGELOG.md`.

Releases are cut automatically by `.github/workflows/deploy.yml`:
every push to `main` whose `package.json#version` differs from the
previous commit triggers a build, a `wrangler deploy`, a `v<version>`
tag, and a GitHub release. PRs that bump the version therefore
release on merge; the work below is mostly about getting the bump
*and the release notes section* right on the PR.

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

When the deploy workflow runs, it parses the squash-commit subject
for the merged PR number, fetches the body via `gh pr view --json
body`, extracts the `## Release notes` section, and passes it to
`gh release create --notes-file`. If the section can't be found
(non-squash merge, body fetch fails) it falls back to GitHub's
`--generate-notes`.

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

## Catalogue refresh policy

External catalogues (AT-HYG, Gaia DR3 cross-walks + 5p astrometry +
NSS + Apsis, Bailer-Jones DR3, Hipparcos-2 van Leeuwen, SIMBAD pulls)
are refreshed by manual `pnpm run refresh:*` invocations, **not** by
`pnpm run build` or the deploy workflow. The build reads the committed
files under `data/<source>/` and never hits the network — see
`scripts/README.md` § Frozen external data for the rationale.

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
validation steps are in `scripts/binaries/README.md` § Refreshing data when
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

## What the deploy workflow does

On every push to `main`, `deploy.yml`:

1. Compares `HEAD:package.json#version` against `HEAD~1:package.json#version`.
   No change → exits silently.
2. Checks out with LFS, sets up Node 24 + Python 3, runs `pnpm install --frozen-lockfile`
   and `pnpm run build` (binaries + catalog + binaries-runtime +
   clouds + local-group + dust-sync + client).
3. Deploys to Cloudflare via `cloudflare/wrangler-action@v4`.
4. Tags `v<version>` and pushes the tag.
5. Extracts the `## Release notes` section from the merging PR's
   body and creates the GitHub release with `--notes-file`. Falls
   back to `--generate-notes` if the section is missing.

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
VERSION=$(node -p "require('./package.json').version")
git tag -a "v$VERSION" -m "v$VERSION"
git push origin "v$VERSION"
# Use --notes-file with the PR's release-notes section, or
# --generate-notes as a quick fallback.
gh release create "v$VERSION" --title "v$VERSION" --generate-notes
pnpm run deploy
```
