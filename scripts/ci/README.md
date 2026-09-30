# CI helpers

Scripts that `.github/workflows/` runs.

- `catalog-stage-pure.ts` (+ test) — the catalogue build stage's steps
  (`CATALOG_STAGE`: each package script and the committed paths it must
  regenerate unchanged), which tracked files the stage can depend on
  (`keyedPaths`), and the cache key they digest to (`catalogCacheKey`).
- `catalog-stage.ts` — the CLI `test.yml` calls. `key` prints the key;
  `paths` prints the keyed files instead, which is how to audit a surprising
  miss or hit; `run` runs each step, then fails on any diff in its pinned
  paths.
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

## The catalogue build cache

`test.yml`'s `build-catalog` job runs `CATALOG_STAGE` — `build:classic-ids`,
`build:wgsn`, `build:membership` and `build:catalog`, each followed by its
regenerate-and-diff gate:
about five minutes, most of it `build:catalog`. The stage is a pure function
of committed files, so on a pull request whose key matches a saved build the
job restores that build's outputs and skips the stage — gates included,
since the committed files they compare against are keyed too.

**The key is every file the stage can read, digested by git blob id**, plus
the Node version:

- the TypeScript import closure of each entry, read from an esbuild
  metafile, so a new import is keyed without anyone listing it;
- every tracked file beside a closure module except `.ts`, `.py` and `.md` — the
  build reads its `*-expected.json` count snapshots by path, not by import.
  These two are `../util/import-closure.ts`, which the local catalogue stamp
  keys too;
- all of `data/`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`,
  `test.yml` and this folder.

**`package.json` is keyed without its `version`**
(`withVersionlessPackageJson`): a digest of every other field stands in for
its blob id. Most pull requests bump the version, so keying it would miss
main's build on every first run. No stage step reads the version.

The stage reads nothing outside that set. **A new read outside it is the one
way to get a stale hit:** a build that reads a
file by path from a folder holding none of its modules must add that folder
to `ALWAYS_KEYED_DIRS`, and a step that starts reading the package version
must drop `withVersionlessPackageJson`. The key errs the other way everywhere else — any
`data/` change misses.

**What is cached** is the stage's untracked files under `public/` and
`build/`, found with `git ls-files --others --ignored`. On a fresh checkout
those are exactly its outputs, so the cached set follows whatever the build
writes; `public/`'s tracked icons and manifest are never cached.

**Exact key only, no `restore-keys`** — a partial match is a stale build.
Push to `main` never restores: it rebuilds and saves, so every merged commit
is verified uncached and pull requests branched from it start warm. A pull
request that misses saves its own build, so its later pushes hit until an
input changes.
