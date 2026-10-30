# Util — shared build-script helpers

Cross-pipeline helpers that don't belong to any single per-pipeline
folder. New entries land here only when at least two consumers need the
same thing — single-use helpers stay with their consumer.

- `citation-index-pure.ts` — the parser for `data/papers/index.md`
  entries (key, label, title, reference line, copy, notes, claims rows)
  and `manifest.json` pins. Read by `site/site-metrics.ts`, whose
  reference counts come off the entries, by `site/json-ld-citations.ts`,
  which publishes each entry to the homepage's JSON-LD, and by
  `tests/citation-index.test.ts`, which holds the index to its rules
  ([Cited papers](/data/papers/README.md#what-enforces-it)).

- `parse-html.ts` — the one HTML parse (`parseHtml`, a HAST tree from
  `rehype-parse`) and `textOf`, an element's text whitespace-collapsed.
  Every reader of a page goes through it rather than a pattern: the
  `site/` derivations, `release/pre-traffic-check-pure.ts` reading the deployed
  pages, and the site suites.

- `escape-regexp.ts` (+ test) — `escapeRegExp(text)`, text made literal
  inside a `RegExp` source, backslash included. Every pattern built from
  page text or a figure goes through it — `citation-index-pure.ts`'s page
  locators, `doc-figures/doc-figures-pure.ts`'s source and key patterns,
  the site suites; a hand-rolled character class beside it is the defect
  CodeQL's `js/incomplete-sanitization` flags.

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
  present-and-smudged predicate over the probe — over a declared file,
  through `sources/source.ts`'s `isReadable(declared)`, which the presence
  check and every suite gating on a declaration's file both call; reach for
  `isLfsPointer` only where the text has to be read anyway. Consumers are
  `sources/source.ts`'s presence check, which every declared read goes
  through, and those suites. All three live here rather than in a domain
  module so this module stays a dependency leaf: everything imports
  `REPO_ROOT` from it.
  `paths.test.ts` pins the pointer-probe cases.
  **No data paths live here**: each is a declaration (`sources/`).
- `build-stamp.ts` / `build_stamp.py` — the content-hash skip gate
  ([Preprocessor idempotency](../README.md#preprocessor-idempotency)): `fileHashes` maps each file's
  repo-relative path to its sha1, `null` when absent, so an input's arrival is
  a change too. A stamp (`build/stamps/<step>.json`) records two such maps:
  the inputs, hashed *before* the build, and every output the build wrote,
  hashed after it. `stampIsCurrent` compares the inputs against the caller's
  and re-hashes the recorded outputs (`changedSince`), so an output rewritten
  by anything other than this build — an older commit's build, a write
  through a symlink, a partial copy — reads as stale. `clearStamp` runs
  before a build writes, `writeStamp` after its asserts pass (for a TS step,
  `emitArtifacts` calls it last, over the emitted set), refusing a
  missing output and landing the stamp by rename, so a stamp on disk is whole
  or absent; an unparseable one still reads as no stamp. The Python sibling serves the two binaries steps and writes
  the same JSON shape, which `tests/artifact-freshness.test.ts` reads from the
  TS side. Its `imported_script_modules()` is those steps' code inputs: every
  `scripts/` module the process has imported, so the import statements are
  the only list. Its `outputs_json` is both steps' `--outputs` answer — their
  output tuple and stamp, repo-relative — which `../worktree-seed.test.ts`
  reads. Both pinned by co-located tests
  (`python3 scripts/util/build_stamp.test.py`).
- `import-closure.ts` / `import-closure-pure.ts` (+ test) — a TypeScript
  build's code inputs. `entryClosure(entries)` is every module the given
  entry files import, read from an esbuild metafile, so a new import joins
  without anyone listing it; `scriptClosure(names)` is that over the named
  `package.json` scripts, each held by `tsxEntry` to exactly `tsx <file>.ts`,
  so `package.json` is the one place an entry is named and no half of a
  chained script is keyed alone. `scriptParts` is the one parser of a
  script's `&&`-chained commands (`tsx`, `python3`, `pnpm run`, or `other`)
  and `tsxEntries` every `tsx` entry among them; `closureWithSiblings(closure, files)` adds every file beside a
  closure module except `.ts`, `.py` and `.md`, which is how the `*-expected.json`
  snapshots a build reads by path get keyed. Shared by the catalogue stamp and
  CI's catalogue cache key ([The catalogue build cache](../ci/README.md#the-catalogue-build-cache)), so the two
  cannot disagree on what the build reads. `trackedFiles()` is the listing the
  stamp passes as `files`.
- `git-provenance.ts` — what a build or instrument records about its
  checkout: `packageVersion`, `headState` (HEAD and whether the tree is
  dirty) and `mergeBaseWithMain` (null with no `origin/main` or in a shallow
  clone), and `fileAtMergeBase`, a file as the merge-base holds it — `absent`
  when it is new on the branch, kept apart from `no-merge-base`. The lineage
  header, perf's `gitMeta` and the two merge-base guards read it.
- `step-inputs.ts` — `stepInputPaths(script)`, every file a `package.json`
  step reads: the closure of each `tsx` entry it chains, the closure's
  siblings, and every declaration the closure reads (`sources/`). The
  catalogue stamp and `build:local-group`'s up-to-date gate both key on it;
  each step's own suite pins its set
  (`../catalog/catalog-inputs.test.ts`, `../local-group/local-group-inputs.test.ts`).
- `tsv/` — the one TSV reader (`readTable`, typed columns, cells that keep
  empty and malformed apart) and `defineArtifact`, the codec of every table
  this repo writes. Own README.
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
- `staged-write.ts` — the one stage-then-rename: `writeStaged` writes
  `<path>.staged` beside its target (same filesystem, so the rename is
  atomic), `landStaged` renames it over the target, and `discardStaged` removes
  a leftover. `writeStamp` and `emitArtifacts` are its two callers, and
  `clearStamp` discards a stamp's leftover too.
- `emit-artifacts.ts` (+ test) — `emitArtifacts({outputs, files, checks,
  stamp})`, the one way a TypeScript pipeline step writes its outputs. Every
  check is already a verdict when it arrives; any `fail` refuses the whole
  emission before a byte is written. Otherwise each file is staged at
  `<path>.staged` beside its target, so the rename stays on one filesystem,
  and only once every file is staged are they renamed into place. A failed
  check, or a crash before the rename phase, therefore leaves every prior
  output byte-identical. The rename phase itself is atomic per file, not per
  set: a crash mid-rename (or mid family-delete) leaves new and old files
  mixed, which only a stamped step detects (its stamp was cleared and is not
  yet rewritten, so it reruns). A
  `.staged` file a killed run left behind is swept by the next run of that
  step; a step with a skip gate (`build:catalog`'s stamp, `build:local-group`'s
  mtime check) calls `sweepStaged` before the gate, since a skipped run never
  reaches `emitArtifacts`. Staging under `public/` would otherwise ship: Vite
  copies it wholesale, and `tests/bundle-content.test.ts` fails on any
  `*.staged` file under `public/` or `dist/`. `outputs` is the step's
  `declareOutputs({key: path, …}, families)` constant, the one place each
  path is written; an emission supplies only contents, keyed the same, so a
  missing or extra key is a compile error. Family members (a directory plus a
  name pattern — the catalogue's transport chunks) arrive separately in
  `members`, by path, and must match a declared family. Family members a run
  does not emit are deleted once the new set has landed. A step that can be
  told to do only some targets (`fetch:ephemerides saturn`, `sid:stamp
  clouds`) still passes its one full declaration, plus `only`: the run must
  emit exactly those keys, and the leftover sweep still covers every declared
  path. A `refresh` check
  (a snapshot under its update flag) stages its own baseline with the outputs.
  `stamp`, when given, is written last over exactly the emitted files, so a
  stamp's outputs and the declaration cannot disagree. A refreshed snapshot
  is usually one of the stamp's inputs too (the `*-expected.json` beside the
  build's modules), so its input hash is re-read after the refresh lands; the
  next run then skips instead of rebuilding for its own refresh.
  `emitEach(outputs, keys, produce)` is the per-target form, for steps whose
  files are each read on their own (the two Horizons fetchers): every target
  that produces and passes its checks lands by itself, a failing one is
  reported and skipped, and the run throws naming the refused targets once
  all have been tried.
  `runStep(main)` is every step's entry point: a refused emission has
  already printed its failed checks, so it exits 1 with one line and no
  stack; any other error keeps its stack.
- `heap-budget.ts` / `heap-budget-pure.ts` (+ test) — `watchHeap(step)`,
  started first thing in a step's `main`, and its `check()`, the step's peak
  live heap against the CI runner's as an `emitArtifacts` check
  ([CI heap budget](#ci-heap-budget)). `build:catalog` and
  `build:membership` carry it.
- `snapshot-check.ts` — `snapshotCheck(spec)`: a build script's computed
  snapshot against its committed JSON, answered as an `emitArtifacts`
  check — `pass`, `fail`, or `refresh` (the rewritten JSON) when the spec's
  env var is `1`. It writes nothing itself. A missing snapshot fails too: a
  deleted `*-expected.json` must fail, not re-baseline itself, so the env var
  is the only way any snapshot is written, a new one included. Used by `build-catalog.ts` (build counts
  under `UPDATE_BUILD_COUNTS`, distance outliers under
  `UPDATE_DISTANCE_OUTLIERS`) and the classic-ID overlay, membership and
  WGSN builds (`UPDATE_BUILD_COUNTS`). The count snapshots all pass
  `compareCountSnapshot` (`catalog/build-counts.ts`) as the compare.
  `snapshot-check.test.ts` pins pass, drift, missing and refresh.
- `snapshot_assert.py` — the Python sibling, for the two binaries steps
  (`build-binaries.py`'s counts, `build-runtime-binaries.py`'s pair
  counts; `binaries/stage7_counts.py` builds its rates snapshot on the same
  primitives). A leaf on purpose: `build_stamp.py` hashes every module a
  step imports, so the runtime step reaching this through `stage7_counts`
  would restamp `binaries.bin` on every pipeline-stage edit. Same rule
  on a missing snapshot: it fails, and only `UPDATE_BUILD_COUNTS=1`
  writes one. Returns a bool where the TS sibling returns an `emitArtifacts` check, since the Python
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
- `mirror-to-public.ts` (+ test) — `mirrorDataFolder(folder, spec)`, the one
  `data/<folder>/` → `public/<folder>/` copy used by
  `scripts/{dust,textures,probes,ephemerides}/sync-*.ts`. `mirrorSource`
  declares the mirrored folder as a folder source (`sources/`): every
  allowlisted file is a member, so each is presence-checked and a file
  added to the folder joins the step's inputs.
  Each folder's constant lives in its `*-mirror-source.ts`. A missing
  source folder or an unsmudged LFS file fails the sync rather than
  shipping an empty or stub layer. Mtime+size skip for up-to-date files; **allowlist**, never denylist, because Vite copies
  `public/` wholesale — anything left in the destination ships, so the
  mirror also purges non-allowlisted strays a previous sync left behind.
  `flattenSubDirs` copies named subfolders of the source into the same
  flat destination, which is how a data folder groups big artifacts at
  rest without moving them in `public/` — so no consumer URL changes when
  it does (`data/textures/relief/`). Names must stay unique across all of
  them: the allowlist is by name, and the purge pass cannot tell two
  same-named files apart.
  `tests/bundle-content.test.ts` asserts the built tree against the same
  predicates. `syncFile(src, dst)` is the one size-and-mtime skip-or-copy:
  the folder mirror's loop and the two single-file copies
  (`sync-local-bubble.ts`, `sync-cloud-surfaces.ts`, each reading its binary
  through a declared source beside it) all call it.

## CI heap budget

A workstation build is no evidence that CI can run the same step: the
catalogue job's `ubuntu-latest` runner gives Node 24 a V8 heap of about
4 GiB, and a step whose live data nears that fails there with `JavaScript
heap out of memory` while passing locally. So a heavy step judges itself
against the runner, not the machine it runs on. `CI_HEAP_LIMIT_BYTES`
(`heap-budget-pure.ts`) is the runner's limit, read off that job's OOM log;
`CI_HEAP_HEADROOM` is the share a step may use.

The measure is **live** heap — what a full (mark-compact) collection leaves
— because that is what runs out: garbage a roomier machine has not yet
collected is not. V8's `GCProfiler` records the heap after every collection
from `watchHeap` on, and `peakLiveHeap` takes the largest a full collection
left, or the heap in use at the check if that is larger. It samples only at
full collections, which is what the headroom covers. Over budget, the check
fails the emission like any other, so nothing lands; the build log prints
the peak beside the budget either way.

When the step is legitimately bigger, shrink what it holds first — the
placement lineage keeps lines, not objects
([Storage and cost](../catalog/lineage/README.md#storage-and-cost)). Raising
the runner's heap (`--max-old-space-size`) is the owner's call, and moves
`CI_HEAP_LIMIT_BYTES` with it.

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
