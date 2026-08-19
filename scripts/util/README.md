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
  tens of megabytes behind it. `lfsContentReadable(path)` is the
  present-and-smudged predicate over the probe, and the one every
  artifact-backed suite gates its `describe.skipIf` on; reach for
  `isLfsPointer` only where the text has to be read anyway. Consumers are
  the SID registry readers and those suites. All three live here rather
  than in `sid/sid-pure.ts` so this module stays a dependency leaf: the
  SID folder imports `REPO_ROOT` from it, so the reverse edge would put
  a domain module under every consumer of a path helper.
  `requireExists(path, refreshHint)` / `readRequired(path, refreshHint)` are the
  build scripts' hard-fail on a missing input: they name `git lfs pull` and the
  file's own refresh target, because the parsers downstream fail on a pointer
  stub with a header error that mentions neither. Both the classic-ID overlay
  build and the astrometry request read the same four cross-walk inputs, which
  is why the guard is here and not in either.
  `paths.test.ts` pins the `maxMtimeOfSources` and pointer-probe cases.
  **No data paths live here.** `ATHYG_CSV` used to, back when three folders
  read the catalogue; the astrometry request moved onto the spine and the
  boundary-epoch cross-check is the last reader left, so the literal sits in
  that suite (`data/athyg/README.md` § Consumed by).
- `tally.ts` — `emptyTallyPartition(values)`, the zeroed per-bucket
  counting record every routing cascade in the catalog build tallies
  into (direction, velocity, V, `dist_src`). Buckets are derived from
  the string-literal tuple that DEFINES each tier set, so a new tier
  cannot tally onto an absent key — `undefined + 1` is NaN, which
  reaches the pinned count snapshot as a hole instead of a drift
  failure. `tally.test.ts` pins all four cascades' key coverage.
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
  `flattenSubDirs` copies named subfolders of the source into the same
  flat destination, which is how a data folder groups big artifacts at
  rest without moving them in `public/` — so no consumer URL changes when
  it does (`data/textures/relief/`). Names must stay unique across all of
  them: the allowlist is by name, and the purge pass cannot tell two
  same-named files apart.
  `tests/bundle-content.test.ts` asserts the built tree against the same
  predicates. The single-file copies (`sync-local-bubble.ts`,
  `sync-cloud-surfaces.ts`) are a different shape and stay standalone.
