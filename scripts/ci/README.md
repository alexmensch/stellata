# CI helpers

Scripts that `.github/workflows/` runs.

- `saved-build.ts` — prints, NUL-separated, the files `test.yml` saves as
  its data build ([The data build cache](#the-data-build-cache)).
- `python_tests.py` (+ test) — the Python suites' runner, below; locally
  `pnpm run test:py`.
- `vitest-no-skip.ts`, `vitest-skips-pure.ts` (+ test) — the whole vitest
  suite, failing on any test that did not run, below; locally
  `pnpm run test:no-skip`.
- `toolchain-pins.test.ts` — `.python-version` and `.nvmrc` each name an
  exact patch release ([The data build cache](#the-data-build-cache)).

## Python suites

`test.yml`'s `Python suites` job runs every `scripts/**/*.test.py`: the
glob is the list, so a new suite runs without a workflow edit. Each file
runs in its own interpreter, since the suites put their own folder on
`sys.path` and several import siblings by bare name; `unittest discover`
is no substitute, as it matches no dotted name like
`stage2_resolve.test.py`.

**A skip fails the run**, and so does a file that runs no tests. The
refresh suites `skipTest` when pyvo, astropy or requests is missing, so a
run that tolerated skips could be green while testing almost nothing. The
job installs `scripts/refresh/requirements-refresh.txt` and
`scripts/textures/requirements.txt`; locally, `pnpm run test:py` with the
venv that holds them activated, as for every other `python3` package
script — without it, the suites that import numpy fail.

## Vitest with every input

`build-catalog`'s `Full vitest, smudged and built` step runs `pnpm test`
through `vitest-no-skip.ts`, which reads vitest's JSON report and **fails
on any test that did not run** — skipped, pending or todo. That job holds
every input a suite can gate on: LFS content, the built catalogue and
layers, and full history. A suite skipping there has lost its input (an
artifact renamed, a build step dropped), and would otherwise go green
without running, in the one job meant to run it.

A suite that can never run in CI — the private paper store in
`tests/citation-index.test.ts` — is not registered under `CI` rather
than skipped. The bare `test` job still allows skips; it has none of
these inputs.

## The data build cache

`test.yml`'s `build-catalog` job builds every step on the table
(`build:data --verify-committed`,
[the runner](../pipeline/README.md#the-runner--runts)), which fails on any
committed output the build moves: the SID registry partitions, the
membership and classic-id tables, `multiples.tsv`, both astrometry requests
and the rest. On the catalogue stage's misses from 2026-11-03 to 2026-11-05,
the stage's median was 554 s on a runner, `build:catalog`'s 346 s of it
(runner log timestamps).

**The cache holds a whole build and the step stamps decide what is reused.**
A pull request restores one saved build, and the runner rebuilds exactly the
steps whose stamp no longer matches. Main saves under `<prefix>main-` and a
pull request under `<prefix>pr-<main SHA>-`, the SHA being its merge
commit's first parent (the main it was built on). The restore takes, in
order:

1. **Its own build on the same main** — main's build plus this PR's changes,
   so only the PR's own new edits rebuild.
2. **Main's newest build.** Once main has moved, the PR's own entry predates
   the landing, and every step whose code the landing touched would rebuild
   from it; main's build has them already, so only the PR's own changes do.
3. **Its own older build**, in a second restore step, only when main has no
   build under the prefix — typically a PR that changes `pnpm-lock.yaml`.

The split prefixes are load-bearing: GitHub tries every restore key against
the PR's own entries before any of main's, so one shared prefix would always
return the PR's own newest entry, however stale.

A stamp hashes every file the step reads as data or code and every file it writes, so a
step hits on whatever build last made it from the same inputs, whatever
commit that was, and a file no step reads that way (a workflow, a
`package.json` script, a README) moves nothing. Python steps are covered the
same way, through their recorded inputs. Build provenance is not an input:
the release and HEAD that lineage and registry headers record
(`releaseAt()` in `../util/release-version.ts`, `../util/git-provenance.ts`)
name the build that made a reused output, not
the commit that reused it.

**The prefix carries what no stamp records**: the runner OS, the Node and
Python versions, and `pnpm-lock.yaml`'s hash. A change to any of these starts
from a cold build. The full key adds `main-` or `pr-<main SHA>-`, then the run
id and attempt, so a run that saves gets an entry of its own.

**`.python-version` and `.nvmrc` name exact patch releases**
(`toolchain-pins.test.ts`). `setup-python` and `setup-node` otherwise
resolve a partial pin to whatever patch the runner image carries or the
newest release, which differs between runners, so two runs of one commit
would key different prefixes and miss each other's builds. Pinned, every job
resolves the same toolchain (downloading it when the image lacks it), the
prefix's versions name the toolchain that built the entry, and an upgrade is
an explicit commit that starts from a cold build. Locally, the checks that
compare runtimes read only part of each pin (`code_identity.py` the
major.minor, the heap budget the Node major), but a version manager reading
these files (pyenv, nvm, uv) wants the exact release installed.

**A run saves only when a step built** (`run.ts` writes `built=true|false`
to the job's `GITHUB_OUTPUT`). A run that rebuilt nothing would upload a copy
of what it restored, and its next push still finds the same entry.

**Main is forced.** A push to `main` restores nothing and runs
`--verify-committed --force`, so every merged commit is still built from
scratch and its committed outputs compared; that bounds a stamp that misses
an input to one merge. Pull requests run unforced.

**A merge group restores main's newest build, runs unforced and saves
nothing.** Its commit is main plus the queued PRs ahead plus its own, so
main's build is the nearest one, and only the steps those PRs touch rebuild.
It saves nothing because no later run would restore it: the group's branch
is deleted once the entry lands or drops, and the commit that lands is
built again, forced, by main's push. That forced build sits off the
landing's critical path, since only `deploy.yml` follows it.

**What is cached** is what the step table owns on disk and git does not
track: each build step's declared outputs, family members and stamp
(`saved-build.ts`, over `../pipeline/build-files.ts`). A file no current step
declares (an output a renamed or deleted step left behind) is never saved,
so a restore cannot bring it back for a reader of the old path to pass on.
`public/`'s tracked icons and manifest are never cached, and the restore
(`tar --skip-old-files`) never replaces a file the checkout has, so a path
tracked since the build was saved keeps its committed content. A run that
built saves even when a step failed: a crashed step's stamp is already
cleared, and a step that failed
verification recorded the outputs it built, so a committed copy that still
differs stales it again on the next push. `cache-cleanup.yml` deletes a pull
request's entries when it closes.
