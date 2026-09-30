# Util — shared build-script helpers

Cross-pipeline helpers that don't belong to any single per-pipeline
folder. New entries land here only when at least two consumers need the
same thing — single-use helpers stay with their consumer. One entry is
shared with `tests/` rather than with a second pipeline, and that is the
bar: repo plumbing with several callers, not a build helper with one.

- `citation-index-pure.ts` — the parser for `data/papers/index.md`
  entries (key, label, title, reference line, copy, notes, claims rows)
  and `manifest.json` pins. Read by `site/site-metrics.ts`, whose
  reference counts come off the entries, by `site/json-ld-citations.ts`,
  which publishes each entry to the homepage's JSON-LD, and by
  `tests/citation-index.test.ts`, which holds the index to its rules
  ([Cited papers](/data/papers/README.md#what-enforces-it)).

- `escape-regexp.ts` (+ test) — `escapeRegExp(text)`, text made literal
  inside a `RegExp` source, backslash included. Every pattern built from
  page text or a figure goes through it; a hand-rolled character class
  beside it is the defect CodeQL's `js/incomplete-sanitization` flags.

- `astronomy_constants.py` — Python mirror of
  `src/client/util/astronomy-constants.ts`. `J2000_JD`,
  `DAYS_PER_JULIAN_YEAR`, and any future physics constants Python-side
  build scripts share with the client runtime. Keep value-by-value in
  sync with the TS canonical; `tests/astronomy-constants-sync.test.ts`
  pins equality.
- `paths.py` — `REPO_ROOT`, the repo-root `Path` every top-level
  Python build/refresh script under `scripts/binaries/` and
  `scripts/refresh/` imports instead of independently walking
  `Path(__file__).resolve().parent...`.
- `paths.ts` — TypeScript sibling of `paths.py`: `REPO_ROOT` for
  `scripts/catalog/*.ts` scripts, and `PACKAGE_JSON`, the manifest's
  repo-relative name, for the readers of its `scripts` table.
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
  `paths.test.ts` pins the pointer-probe cases.
  **No data paths live here.** `ATHYG_CSV` used to, back when three folders
  read the catalogue; the astrometry request moved onto the membership
  manifest and the boundary-epoch cross-check is the last reader left, so the
  literal sits in that suite ([Consumed by](/data/athyg/README.md#consumed-by)).
- `build-stamp.ts` / `build_stamp.py` — the content-hash skip gate
  ([Preprocessor idempotency](../README.md#preprocessor-idempotency)): `fileHashes` maps each file's
  repo-relative path to its sha1, `null` when absent, so an input's arrival is
  a change too. A stamp (`build/stamps/<step>.json`) records two such maps:
  the inputs, hashed *before* the build, and every output the build wrote,
  hashed after it. `stampIsCurrent` compares the inputs against the caller's
  and re-hashes the recorded outputs (`changedSince`), so an output rewritten
  by anything other than this build — an older commit's build, a write
  through a symlink, a partial copy — reads as stale. `clearStamp` runs
  before a build writes, `writeStamp` after its asserts pass, refusing a
  missing output and landing the stamp by rename, so a stamp on disk is whole
  or absent; an unparseable one still reads as no stamp. The Python sibling serves the two binaries steps and writes
  the same JSON shape, which `tests/artifact-freshness.test.ts` reads from the
  TS side. Its `imported_script_modules()` is those steps' code inputs: every
  `scripts/` module the process has imported, so the import statements are
  the only list. Both pinned by co-located tests
  (`python3 scripts/util/build_stamp.test.py`).
- `import-closure.ts` / `import-closure-pure.ts` (+ test) — a TypeScript
  build's code inputs. `scriptClosure(names)` is every module the named
  `package.json` scripts import, read from an esbuild metafile, so a new
  import joins without anyone listing it; `tsxEntry` holds each such script
  to exactly `tsx <file>.ts`, so `package.json` is the one place an entry is
  named; `closureWithSiblings(closure, files)` adds every file beside a
  closure module except `.ts`, `.py` and `.md`, which is how the `*-expected.json`
  snapshots a build reads by path get keyed. Shared by the catalogue stamp and
  CI's catalogue cache key ([The catalogue build cache](../ci/README.md#the-catalogue-build-cache)), so the two
  cannot disagree on what the build reads. `trackedFiles()` is the listing the
  stamp passes as `files`.
- `output-identity.ts` (+ `output-identity-pure.ts`, its diff and test) —
  `pnpm run identity:snapshot` / `identity:diff`, the byte-identity check in
  [Proving a restructuring byte-identical](#proving-a-restructuring-byte-identical).
- `tally.ts` — `emptyTallyPartition(values)`, the zeroed per-bucket
  counting record every routing cascade in the catalog build tallies
  into (direction, velocity, V, distance). Buckets are derived from
  the string-literal tuple that DEFINES each tier set, so a new tier
  cannot tally onto an absent key — `undefined + 1` is NaN, which
  reaches the pinned count snapshot as a hole instead of a drift
  failure. `tally.test.ts` pins all four cascades' key coverage.
- `snapshot-assert.ts` — `assertOrUpdateSnapshot(spec)`: compare a build
  script's computed snapshot against its committed JSON, or rewrite the
  JSON when the spec's env var is `1`. Exits non-zero on drift, and on a
  missing snapshot too: a deleted `*-expected.json` must fail, not
  re-baseline itself, so the env var is the only way any snapshot is
  written, a new one included. Used by `build-catalog.ts` (build counts
  under `UPDATE_BUILD_COUNTS`, distance outliers under
  `UPDATE_DISTANCE_OUTLIERS`) and the classic-ID overlay, membership and
  WGSN builds (`UPDATE_BUILD_COUNTS`). The count snapshots all pass
  `compareCountSnapshot` (`catalog/build-counts.ts`) as the compare.
  `snapshot-assert.test.ts` pins the missing-snapshot case.
- `snapshot_assert.py` — the Python sibling, for the two binaries steps
  (`build-binaries.py`'s counts, `build-runtime-binaries.py`'s pair
  counts; `binaries/stage7_counts.py` builds its rates snapshot on the same
  primitives). A leaf on purpose: `build_stamp.py` hashes every module a
  step imports, so the runtime step reaching this through `stage7_counts`
  would restamp `binaries.bin` on every pipeline-stage edit. Same rule
  on a missing snapshot: it fails, and only `UPDATE_BUILD_COUNTS=1`
  writes one. Returns a bool where the TS side exits, since the Python
  drivers own their exit.
  Pinned by `snapshot_assert.test.py`.
- <a id="git-files"></a>`git-files.ts` — `gitFiles(root, pathspecs, { untracked })`,
  git's file list (tracked, optionally untracked-but-not-ignored), for a scan
  whose scope is the repo rather than a folder list; `presentFiles`, the names
  that are regular files on disk — git still lists a tracked file deleted but
  not staged, and a symlink (`CLAUDE.md`) would double its target; and
  `lfsTracked`, which of those names Git LFS stores. Shared by the repo-meta
  suites under `tests/` and `doc-figures/`; `git-files.test.ts` pins the
  deleted, symlinked and untracked cases over a throwaway repo.
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

## Proving a restructuring byte-identical

A pipeline restructuring promises unchanged outputs; prove it, don't
eyeball it. Both commands first rebuild everything from scratch: they delete
the gitignored files under `public/` and every stamp, then run
`pnpm run build:data`. A stamp's input list can miss a file the step reads, so
a skipped step proves nothing; a missing output is what makes every
mtime-gated emitter rebuild too. Each run costs a cold catalogue build (about
six minutes), and a dev server on the same checkout serves nothing meanwhile.

1. On the base commit, `pnpm run identity:snapshot` hashes every output into
   the gitignored `build/output-identity.json`: every file under `public/`
   (the emitters, the `*-sync` mirrors and the committed static assets) plus
   each stamp's recorded outputs outside it, such as
   `build/catalog-row-index-map.json`. Both sets are read off disk, so a new
   step or emitter joins without an edit, and a stray file reads as appeared.
2. Check out the branch; `pnpm run identity:diff` prints
   `identical: N outputs` and exits 0, or names each changed, appeared and
   vanished file and exits 1.

Quote the `identical` line in the PR body. `data/binaries/multiples.tsv` is
also committed, so `git diff` shows it field by field; for the catalogue,
`pnpm run validate:record-parity` gives the field diff keyed by SID.
`public/binaries.bin` has a golden test besides
([binaries.bin golden](../binaries/golden/README.md)), which runs in
`pnpm test` with no build.
