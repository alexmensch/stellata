# Util — shared build-script helpers

Cross-pipeline helpers that don't belong to any single per-pipeline
folder. New entries land here only when at least two build scripts
need the same thing — single-use helpers stay with their consumer.

- `astronomy_constants.py` — Python mirror of
  `src/client/util/astronomy-constants.ts`. `J2000_JD`,
  `DAYS_PER_JULIAN_YEAR`, and any future physics constants Python-side
  build scripts share with the client runtime. Keep value-by-value in
  sync with the TS canonical; the `astronomy_constants_sync.test.py`
  sibling test pins equality at CI time.
- `paths.py` — `REPO_ROOT`, the repo-root `Path` every top-level
  Python build/refresh script under `scripts/binaries/` and
  `scripts/refresh/` imports instead of independently walking
  `Path(__file__).resolve().parent...`.
- `paths.ts` — TypeScript sibling of `paths.py`: `REPO_ROOT` for
  `scripts/catalog/*.ts` scripts, plus `mtimeIfExists(path)` and
  `maxMtimeOfSources(paths)` (newest mtime over present paths, 0 if all
  missing) for build-idempotency checks against optional inputs.
  `paths.test.ts` pins the `maxMtimeOfSources` cases.
- `mirror-to-public.ts` — `mirrorDataFolder(spec)`, the one
  `data/<folder>/` → `public/<folder>/` copy used by
  `scripts/{dust,textures,probes}/sync-*.ts`. Mtime+size skip for
  up-to-date files; **allowlist**, never denylist, because Vite copies
  `public/` wholesale — anything left in the destination ships, so the
  mirror also purges non-allowlisted strays a previous sync left behind.
  `tests/bundle-content.test.ts` asserts the built tree against the same
  predicates. The single-file copies (`sync-local-bubble.ts`,
  `sync-cloud-surfaces.ts`) are a different shape and stay standalone.
