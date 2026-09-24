# CI helpers

Scripts that `.github/workflows/` runs and nothing else does.

- `catalog-cache-key-pure.ts` (+ test) — which tracked files the catalogue
  build stage can depend on (`keyedPaths`), and the cache key they digest to
  (`catalogCacheKey`). The test also pins `test.yml`'s key arguments to the
  steps it skips on a hit.
- `catalog-cache-key.ts` — the CLI `test.yml` calls with the stage's
  package-script names. Prints the key; `--paths` prints the keyed files
  instead, which is how to audit a surprising miss or hit.

## The catalogue build cache

`test.yml`'s `build-catalog` job runs `build:classic-ids`, `build:wgsn`,
`build:membership` and `build:catalog` with their regenerate-and-diff gates:
about five minutes, most of it `build:catalog`. The stage is a pure function
of committed files, so on a pull request whose key matches a saved build the
job restores that build's outputs and skips the stage — gates included,
since the committed files they compare against are keyed too.

**The key is every file the stage can read, digested by git blob id**, plus
the Node version:

- the TypeScript import closure of each entry, read from an esbuild
  metafile, so a new import is keyed without anyone listing it;
- every tracked file beside a closure module except `.ts` and `.md` — the
  build reads its `*-expected.json` count snapshots by path, not by import;
- all of `data/`, `package.json`, `pnpm-lock.yaml`, `tsconfig.json`,
  `test.yml` and this folder.

The stage reads nothing outside that set. **A new read outside it is the one
way to get a stale hit:** a build that reads a
file by path from a folder holding none of its modules must add that folder
to `ALWAYS_KEYED_DIRS`. The key errs the other way everywhere else — any
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
