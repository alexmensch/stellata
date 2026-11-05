# CI helpers

Scripts that `.github/workflows/` runs.

- `saved-build.ts` — prints, NUL-separated, the files `test.yml` saves as
  its data build ([The data build cache](#the-data-build-cache)).
- `python_tests.py` (+ test) — the Python suites' runner, below; locally
  `pnpm run test:py`.
- `vitest-no-skip.ts`, `vitest-skips-pure.ts` (+ test) — the whole vitest
  suite, failing on any test that did not run, below; locally
  `pnpm run test:no-skip`.

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
A pull request restores the newest saved build whose key starts with the
prefix: its own previous push's first, else main's latest. The runner then
rebuilds exactly the steps whose stamp no longer matches. A stamp hashes
every file the step reads as data or code and every file it writes, so a
step hits on whatever build last made it from the same inputs, whatever
commit that was, and a file no step reads that way (a workflow, a
`package.json` script, a README) moves nothing. Python steps are covered the
same way, through their recorded inputs. Build provenance is not an input:
the package version and HEAD that lineage and registry headers record
(`../util/git-provenance.ts`) name the build that made a reused output, not
the commit that reused it.

**The prefix carries what no stamp records**: the runner OS, the Node and
Python versions, and `pnpm-lock.yaml`'s hash. A change to any of these starts
from a cold build. The full key adds the run id and attempt, so every run
saves a build of its own.

**Main is forced.** A push to `main` restores nothing and runs
`--verify-committed --force`, so every merged commit is still built from
scratch and its committed outputs compared; that bounds a stamp that misses
an input to one merge. Pull requests run unforced.

**What is cached** is what the step table owns on disk and git does not
track: each build step's declared outputs, family members and stamp
(`saved-build.ts`, over `../pipeline/build-files.ts`). A file no current step
declares (an output a renamed or deleted step left behind) is never saved,
so a restore cannot bring it back for a reader of the old path to pass on.
`public/`'s tracked icons and manifest are never cached, and the restore
(`tar --skip-old-files`) never replaces a file the checkout has, so a path
tracked since the build was saved keeps its committed content. A run saves even when a step
fails: a crashed step's stamp is already cleared, and a step that failed
verification recorded the outputs it built, so a committed copy that still
differs stales it again on the next push. `cache-cleanup.yml` deletes a pull
request's entries when it closes.
