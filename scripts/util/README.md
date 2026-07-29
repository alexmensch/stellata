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
  `isLfsPointer(text)` recognises a pointer stub from a head string and
  `isLfsPointerFile(path)` probes a file's head for one — the state the
  bare CI test job leaves LFS-tracked inputs in — without reading the
  tens of megabytes behind it. Consumers are the SID registry readers,
  the spine generator's required-inputs gate, and every artifact-backed
  suite that self-skips when LFS hasn't smudged. Both live here rather
  than in `sid/sid-pure.ts` so this module stays a dependency leaf: the
  SID folder imports `REPO_ROOT` from it, so the reverse edge would put
  a domain module under every consumer of a path helper.
  `paths.test.ts` pins the `maxMtimeOfSources` and pointer-probe cases.
- `snapshot-assert.ts` — `assertOrUpdateSnapshot(spec)`: compare a build
  script's computed snapshot against its committed JSON, or rewrite the
  JSON when the spec's env var is `1`. Exits non-zero on drift, since a
  drifted snapshot must not ship an artifact; a missing snapshot writes
  itself, which is what bootstraps a new one. Shared by
  `build-catalog.ts` (build counts, distance outliers) and
  `catalog/classic-ids/build-classic-id-overlay.ts` — all three under
  `UPDATE_BUILD_COUNTS` / `UPDATE_DISTANCE_OUTLIERS`.
- `horizons-response.ts` — the JPL Horizons endpoint, the two API limits
  (`MAX_LIST_EPOCHS`, `MAX_RANGE_ROWS`), the retrying + paced
  `fetchHorizonsText`, and the header / `$$SOE`-block readers. The typed
  per-ephemeris-type parsers sit on top: `scripts/probes/horizons-vectors.ts`
  and `scripts/ephemerides/horizons-elements.ts`. `rangeChunks` splits a
  uniform-cadence span into range queries whose endpoints land on grid
  epochs.
- `frozen-json.ts` — `serializeRowFile` (one sample array per line, so a
  thousand-row artifact still diffs sample-by-sample in git) and
  `roundSignificant`, shared by the probe-trajectory and planet-element
  emitters.
- `mirror-to-public.ts` — `mirrorDataFolder(spec)`, the one
  `data/<folder>/` → `public/<folder>/` copy used by
  `scripts/{dust,textures,probes}/sync-*.ts`. Mtime+size skip for
  up-to-date files; **allowlist**, never denylist, because Vite copies
  `public/` wholesale — anything left in the destination ships, so the
  mirror also purges non-allowlisted strays a previous sync left behind.
  `tests/bundle-content.test.ts` asserts the built tree against the same
  predicates. The single-file copies (`sync-local-bubble.ts`,
  `sync-cloud-surfaces.ts`) are a different shape and stay standalone.
