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

- `astronomy_constants.py` — Python mirror of two values from
  `src/astro-core/astronomy-constants.ts`, `J2000_JD` and
  `DAYS_PER_JULIAN_YEAR`; `tests/astronomy-constants-sync.test.ts` pins
  equality. It is not the home of every constant Python shares: the
  binaries stages define their own (`AU_PER_PC` in `stage5_optical.py`,
  `CATALOG_SCENE_EPOCH` in `stage6_multiples.py`), and the asset bakers
  read theirs from `baker_constants.py`.
- `baker_constants.py` (+ test) — `CONSTANTS`, `src/astro-core/baker-constants.json`
  loaded once: the facts the Python asset bakers share with TypeScript
  ([Baker constants](/src/astro-core/README.md#baker-constants)).
  `merge_shared` folds a per-body block of it into a baker's own per-body
  table and refuses unless the two name the same bodies; `dem_relief.py`'s
  `DEM_BODIES` and `build-textures.py`'s `RING_TABLES` are built with it.
- `paths.py` — `REPO_ROOT`, the repo-root `Path` every top-level
  Python build/refresh script under `scripts/binaries/` and
  `scripts/refresh/` imports instead of independently walking
  `Path(__file__).resolve().parent...`.
- `paths.ts` — TypeScript sibling of `paths.py`: `REPO_ROOT` for
  `scripts/catalog/*.ts` scripts, and `PACKAGE_JSON`, the manifest's
  repo-relative name, for the readers of its `scripts` table.
  `PUBLIC_DIR` is Vite's `publicDir`, the folder the build ships;
  `publicRepoPath(name)` and `publicFile(name)` place a public artifact's
  name (`/src/catalog-format/public-artifacts/`) in it, repo-relative and
  absolute.
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
- `build-stamp.ts` / `build_stamp.py` — the content-hash stamp
  ([Preprocessor idempotency](../README.md#preprocessor-idempotency)): `fileHashes` maps each file's
  repo-relative path (relative to a passed root, the runner's tree) to its
  sha1 (`hashFile`, `stamp-hash.ts`), `null` when absent, so an input's arrival is
  a change too. `inputHashes` is the same map with each code file hashed by
  its identity (`code-identity.ts`), and `recordedInputs` turns a Python run
  record's reads into it, keeping the first-read bytes hash of a code file
  edited mid-run, which no identity equals, so the step reads stale. A stamp (`build/stamps/<step>.json`) records two
  maps: the inputs (`inputHashes`), hashed *before* the build, and every
  output the build wrote (`fileHashes`, bytes, so a generated `.ts` output
  whose comment moved still differs), hashed after it; `changedSince`
  re-hashes a recorded map with the hasher that wrote it, so an output
  rewritten by anything other than this build — an older commit's build, a
  write through a symlink, a partial copy — reads as stale. The runner is the
  only writer: `clearStamp` before a step runs, `writeStamp` once it exits 0,
  refusing a missing output and landing the stamp by rename, so a stamp on
  disk is whole or absent; an unparseable one still reads as no stamp. The
  freshness verdict over a stamp is `../pipeline/freshness.ts`'s.
  `build_stamp.py` is the Python step recorder below, pinned by
  `python3 scripts/util/build_stamp.test.py`.
  `stamp-path-pure.ts` names the files: `stampPath(name, root)` is
  `build/stamps/<name>.json` with `:` written `-` (`stepFileName`, which names
  a step's lock too).
  A stamp the runner writes for a Python step also carries `recorded`: the
  folders it listed (`listingHash`, over the sorted names git does not
  ignore, so a local cache in a listed folder reads the same in every
  checkout) and the paths it probed, which `recordedChanges` re-checks.
  `ignoredPaths` is the one `git check-ignore` call, which `listingHash` and
  `../pipeline/record-step.ts` both make.
  `record_run` is how the runner runs a Python step
  (`../pipeline/run_python_step.py`): Python's audit hook records, under a
  root, every file the process opens for reading, hashed at its first read
  (a file the step wrote before reading it is not an input), every
  directory it lists (its sorted names, which the runner hashes; the import
  system's own scans of `sys.path` are not listings), and every file it
  writes — a rename's target, not its temp file, and not a scratch file it
  deleted — plus each module the step loaded (not those already loaded
  when the recording began: the recorder's own `run_python_step.py`,
  `build_stamp.py`, `stamp_hash.py` and `paths.py`, so editing the recorder stales no
  step), nothing under `.venv` or `__pycache__` included, into a JSON
  record the runner turns
  into the step's stamp. An existence check opens nothing, so a step probes
  through `probe(path)`, which records the answer. `report_service(name)`
  records which network service answered, once each in first-answer order
  (`refresh_lib.TapClient` calls it); `record.ts` copies the list into a
  pull's committed record as `answeredBy`.
- `stamp-hash.ts` / `stamp_hash.py` (+ tests) — the stamp hash, sha1, and its
  only spelling in each language: `hashFile` / `hash_file` over a file's bytes
  and `hashBytes` / `hash_bytes` over bytes still in memory, equal for equal
  bytes. Every stamp-side digest is taken with one of them — `build-stamp.ts`'s
  maps and `listingHash`, a code identity in either language, the lineage
  header's file hashes, `../pipeline/freshness.ts`'s query and request hashes,
  a recorded run's reads. A leaf below both stamp modules and both
  code-identity modules, since `build-stamp.ts` imports `code-identity.ts`.
  The two languages must agree byte for byte, since `recordedInputs` compares
  a Python-recorded hash against a TypeScript one; both suites pin the same
  digests.
- `code-identity.ts` / `code_identity.py` (+ test) — a code input's identity,
  the one rule for every step: the sha1 of its token stream with comments
  and docstrings dropped, so a comment, docstring or layout edit stales
  nothing and any change to a token the interpreter executes stales every
  step that read the file. `CODE_FILE` (`.py`, `.ts`, `.mts`; `import-closure-pure.ts`) is the one
  test of what is code, by extension wherever the file is read, so a Python
  bake reading a generated `.ts` keys it the same way. TypeScript is the
  compiler's tokens, walked from the parsed tree, since a bare scanner reads
  `//` inside a regex or template literal as a comment. Python is the
  standard library's `tokenize` (`python3 -I -S`, one process per batch):
  comments and non-logical newlines dropped, indentation as structure only,
  and a logical line of nothing but plain string literals (a docstring, or
  any bare string statement) dropped; an f-string is never such a line. A
  file `tokenize` rejects (a half-edited input) keys as `raw:` plus its
  bytes hash, which no identity equals, so its steps read stale and the rest
  of the batch still hashes. It refuses a `python3` whose major.minor is not
  `.python-version`'s, since `tokenize` output differs across versions (3.12
  split f-strings into tokens) and a local identity must equal CI's.
  Changing either normaliser changes every recorded code identity, so it
  re-keys the committed `data/stamps/` records in the same commit.
- `import-closure.ts` / `import-closure-pure.ts` (+ test) — a TypeScript
  build's code inputs. `entryClosure(entries)` is every module the given
  entry files import, read from an esbuild metafile (`entryMetafile`, which
  the runner also reads for an outputs module's imports), so a new import joins
  without anyone listing it. `scriptParts` is the one parser of a
  script's `&&`-chained commands (`tsx`, `python3`, `pnpm run`, or `other`)
  and `tsxEntries` every `tsx` entry among them; `runnerTargets` the
  targets of a script that is one `run.ts` call (`RUNNER`), else `null`;
  `closureWithSiblings(closure, files)` adds every file beside a
  closure module except code (`CODE_FILE`) and `.md`, which is how the `*-expected.json`
  snapshots a build reads by path get keyed. `trackedFiles()` is the listing the
  stamp passes as `files`.
- `git-provenance.ts` — what a build or instrument records about its
  checkout: `packageVersion`, `headCommit`, `headState` (HEAD and whether
  the tree is dirty), `onMainBranch` (HEAD is on the branch `MAIN_REF`
  tracks; false when detached), `inHeadHistory` (whether a commit is HEAD or an
  ancestor of it) and `mergeBaseWithMain` (null with no `origin/main` or in a
  shallow clone), and `fileAtMergeBase`, a file as the merge-base holds it — `absent`
  when it is new on the branch, kept apart from `no-merge-base`. The lineage
  header, perf's `gitMeta` and the two merge-base guards read it. `gitIn` is
  its git call, in a given folder; `fileAt(commit, path)`, a file's bytes as
  a commit stores it, is what `fileAtMergeBase` decodes and
  `input-hashes-at.ts` hashes.
- `input-hashes-at.ts` (+ test) — `inputHashesAt(commit, inputs)`: an
  `inputHashes` map with each path that differs on disk from `commit`
  re-hashed from `commit`'s copy (code by identity; LFS content read from the
  local object its pointer names, never fetched, so no network call and no
  `GIT_LFS_SKIP_SMUDGE` pointer read as content), `unknown` where git holds
  no copy — a git-ignored input, or LFS content not stored locally;
  `onDiskHashes(paths, hashed)`, a map over `paths` taking what it is handed
  and hashing the rest from disk; and `deletedSiblingsSince(commit, inputs)`,
  the files deleted since `commit` that sat beside a code input — the
  siblings a build at `commit` read (`closureWithSiblings`'s rule). Kept out
  of `git-provenance.ts` so the perf instruments reading that do not load the
  TypeScript compiler. The lineage baseline verdict reads it
  ([The verdict](../catalog/lineage/baseline/README.md#the-verdict--one-map-comparison)).
- `source-trees.ts` — `TREE_ROOTS` and `treeOf`, which tree a repo path
  belongs to, and `BROWSER_TREES`: the one list both import-boundary tests
  (`/tests/README.md#pipeline-viewer-boundary`) and the step table's
  outputs-module walk ([Load-time rules](../pipeline/step-table/README.md#load-time-rules)) read.
- `round-pure.ts` (+ test) — `roundHalfEven(x, digits)`, Python's
  `round`: half to even on the double's exact decimal value; and
  `roundSignificant(v, digits)`, significant figures through
  `toPrecision`. Every number a TypeScript build rounds into a JSON
  artifact goes through one of them, never `Math.round(x · 10ⁿ) / 10ⁿ`,
  whose multiply moves near-ties.
- `step-inputs.ts` — `entryInputPaths(entries)`, every file a TypeScript
  step reads: the closure of its entry files, the closure's siblings, and
  every declaration the closure reads (`sources/`); the runner derives each
  TypeScript step's inputs with it ([The step table](../pipeline/step-table/README.md#the-step-table--stepsts)).
  `stepEntries(name)` is a step's entry: its `steps.ts` entry when the step is
  on the table (`package.json` then names only `run.ts`), else each `tsx` entry
  its `package.json` script chains; `stepInputPaths(name)` is
  `entryInputPaths` over it, for the suites that pin a step's set. No step's
  own code imports this module: a step's input hashes come from
  `step-input-hashes.ts`.
  Each step's own suite pins its set (`../catalog/catalog-inputs.test.ts`,
  `../local-group/local-group-inputs.test.ts`, `../clouds/clouds-inputs.test.ts`).
- `step-input-hashes.ts` — the runner's pre-run input hashes, handed to a
  TypeScript step: `../pipeline/processes.ts`'s `runTs` writes them
  (`writeStepInputs`) to `build/step-inputs/<step>.json`, names it in
  `PIPELINE_STEP_INPUTS` (`STEP_INPUTS_ENV`) and removes it when the step
  exits; the step reads them with `stepInputHashes()`, which throws when the
  step was started any other way. It is the pre-run map: what the step read.
  The stamp's input map is `stampedInputMap(handed, rewritten)`, the handed
  map with each input the step also wrote (every input under
  `--update-snapshots`) re-hashed after the run, so for `build:membership`
  and `build:catalog`, which rewrite inputs, the two differ on those entries;
  the runner builds every stamp's inputs through it. A step that needs its
  own input hashes (a lineage header's input map) reads the handed map here
  and never re-derives them.
- `tsv/` — the one TSV reader (`readTable`, typed columns, cells that keep
  empty and malformed apart) and `defineArtifact`, the codec of every table
  this repo writes. Own README.
- `output-identity.ts` (+ `output-identity-pure.ts`, its diff and test) —
  `pnpm run identity:snapshot` / `identity:diff`, the byte-identity check in
  [Proving a restructuring byte-identical](#proving-a-restructuring-byte-identical).
- `counts/` — the one tally (`fold`) and the staged count snapshot
  (`nestByStage`, `flattenStages`). Own README.
- `staged-write.ts` — the one stage-then-rename: `writeStaged` writes
  `<path>.staged` beside its target (same filesystem, so the rename is
  atomic) — the bytes given, or a copy of `{copyFrom}`'s file, which never
  holds it in memory (the mirrors' layers run to ~140 MB) — `landStaged` renames it over the target, and `discardStaged` removes
  a leftover. `writeStamp` and `emitArtifacts` are its two callers, and
  `clearStamp` discards a stamp's leftover too.
- `emit-artifacts.ts` (+ test) — `emitArtifacts({outputs, files, checks})`,
  the one way a TypeScript pipeline step writes its outputs. Every
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
  step; a step that can fail before it emits (`build:catalog`, `build:clouds`,
  `build:local-group`) calls `sweepStaged` first, since such a run never
  reaches `emitArtifacts`. Staging under `public/` would otherwise ship: Vite
  copies it wholesale, and `tests/bundle-content.test.ts` fails on any
  `*.staged` file under `public/` or `dist/`. `outputs` is the step's
  `declareOutputs({key: path, …}, families)` constant, the one place each
  path is written, a relative one read as repo-relative
  (`isDeclaredOutputs` holds a value it returned, never a look-alike, which
  is how `/tests/step-coverage.test.ts` finds them); an emission supplies only contents (bytes, or `{copyFrom: path}`), keyed the same, so a
  missing or extra key is a compile error. Family members (a directory plus a
  name pattern — the catalogue's transport chunks — or the exact names a
  member may take, as each lineage stage's baseline does, so stages can share
  the folder) arrive separately in
  `members`, by path, and must match a declared family. Family members a run
  does not emit are deleted once the new set has landed; `familyMembers` is
  the one listing of a family on disk, which the runner stamps from too. A
  step that can be told to do only some targets (`fetch:ephemerides saturn`),
  or that leaves a SID registry partition alone when its allocation appended
  nothing (`build:local-group`, `build:clouds`), still passes its one full
  declaration, plus `only`: the run must
  emit exactly those keys, and the leftover sweep still covers every declared
  path. A `refresh` check
  (a snapshot under its update flag) stages its own baseline with the outputs.
  `stampedMembers` is the one listing of the family members a stamp records
  — less those of a family declared `stamped: false` (the lineage baseline and
  diff, which no worktree seed carries) — which the runner stamps from.
  `emitEach(outputs, keys, produce)` is the per-target form, for steps whose
  files are each read on their own (the two Horizons fetchers): every target
  that produces and passes its checks lands by itself, a failing one is
  reported and skipped, and the run throws naming the refused targets once
  all have been tried.
  `runStep(entry, args)` is how every script runs, and `launch.ts` its one
  command line: `package.json` names `tsx scripts/util/launch.ts <entry>`
  (`import-closure-pure.ts`'s `LAUNCHER`; `scriptParts` reads any other
  `tsx` command as unclassified, which `/tests/source-declarations.test.ts`
  fails), and the runner and `record.ts` start a TypeScript step the same
  way (`../pipeline/processes.ts`'s `launchArgs`). An entry exports `main`
  and never calls it (`/tests/source-declarations.test.ts` parses every
  launched entry and fails any top-level statement that is not a
  declaration), so **importing a package-script or step entry runs
  nothing** — the input-set walk (`sources/declared-inputs.ts`) can import
  whatever its name matches. A script no `package.json` command names
  (CI's `pnpm exec tsx` calls, the commit-sweep figure check,
  `binaries/golden/cut-fixture.ts`) is neither, and no step's closure
  reaches one. `runStep` imports the entry, hands it `process.argv` as
  `tsx` would have, and runs `main`: a number it returns is the exit
  status; a refused emission has already printed its failed checks, so it
  exits 1 with one line and no stack; any other error keeps its stack. A
  TypeScript manual step that describes itself also exports `describe`,
  sync or async — a pull's `PullDescription` (the two Horizons fetchers),
  or a bake's `Projection` of a file it reads — and `--describe` then
  prints what it returns instead of running.
  `horizons-response.ts`' `HORIZONS_SERVICE` is the service both state.
- `heap-budget.ts` / `heap-budget-pure.ts` (+ test) — `watchHeap(step)`,
  started first thing in a step's `main`, and its `check()`, the step's peak
  live heap against the CI runner's as an `emitArtifacts` check
  ([CI heap budget](#ci-heap-budget)). `build:catalog` and
  `build:membership` carry it.
- `snapshot-check.ts` — `snapshotCheck(spec)`: a build script's computed
  snapshot against its committed JSON, answered as an `emitArtifacts`
  check — `pass`, `fail`, or `refresh` (the rewritten JSON) when
  `UPDATE_SNAPSHOTS` (`UPDATE_SNAPSHOTS_ENV`) is `1`, the variable the
  runner's `--update-snapshots` sets. It writes nothing itself. A missing
  snapshot fails too: a deleted `*-expected.json` must fail, not re-baseline
  itself, so the variable is the only way any snapshot is written, a new one
  included. One variable refreshes every snapshot a run reaches. A drift
  message names the refresh command: `pnpm run <step> --update-snapshots`
  when `PIPELINE_STEP` is set (the runner sets it to each step it runs, and
  drops an inherited `UPDATE_SNAPSHOTS`), the variable form otherwise;
  `snapshot_assert.py` does the same. Used by
  `build-catalog.ts` (build counts and distance outliers) and the classic-ID
  overlay, membership and WGSN builds. The count snapshots all pass
  `compareCountSnapshot` (`catalog/build-counts.ts`) as the compare.
  `snapshot-check.test.ts` pins pass, drift, missing and refresh.
- `snapshot_assert.py` — the Python sibling, for the two binaries steps
  (`build-binaries.py`'s counts, `build-runtime-binaries.py`'s pair
  counts; `binaries/stage7_counts.py` builds its rates snapshot on the same
  primitives). A leaf on purpose: `build_stamp.py` hashes every module a
  step imports, so the runtime step reaching this through `stage7_counts`
  would restamp `binaries.bin` on every pipeline-stage edit. Same rule
  on a missing snapshot: it fails, and only `UPDATE_SNAPSHOTS=1`
  writes one. Returns a bool where the TS sibling returns an `emitArtifacts` check, since the Python
  drivers own their exit. Every snapshot it writes is staged: a caller
  hands it `Staged` counts (stage → count, each count built inside its
  stage's block, stages in pipeline order), and it compares both sides
  through `flatten_stages`, `counts/count-stages-pure.ts`'s twin.
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
  thousand-row artifact still diffs sample-by-sample in git), shared by the
  probe-trajectory and planet-element emitters.
- `mirror-to-public.ts` (+ test) — `mirror(folder)`, the one `data/` →
  `public/` copy, which every `build:<layer>-sync` step runs
  (`scripts/<layer>/sync-<layer>.ts`; `steps.ts`'s `MIRROR_STEPS`: dust,
  probes, ephemerides, local-bubble, cloud-surfaces, textures). What a
  mirror ships is its `<layer>-mirror-outputs.ts` declaration and nothing
  else: a family per pattern-named or rostered folder, a file per fixed
  name (the dust manifest, `local-bubble.bin`, `cloud-surfaces.bin`).
  `mirrorSource` declares the data folder (`sources/`) with the
  declaration as its **allowlist** (`declaresName`), never a denylist, so
  each copied file is presence-checked and a file added to the folder joins
  the step's inputs; a single file is an allowlist of one. A missing source
  folder, a declared file missing from it, or an unsmudged LFS file fails
  the step rather than shipping an empty or stub layer. The copy is one
  `emitArtifacts` emission, so a family member the source lost is deleted;
  the runner's stamp decides when it runs. Vite copies `public/` wholesale,
  so every family folder is the mirror's alone and `strays(outputs)` — any
  undeclared name in one — is purged after the copy; a mirror family at
  `public/` itself would purge the whole folder, which is why the
  single-file mirrors declare files; `steps.test.ts` holds every mirror's family
  folders to that mirror alone, none of them `public/` itself. `flattenSubDirs` copies named
  subfolders of the source into the same flat destination, which is how a
  data folder groups big artifacts at rest without moving them in
  `public/` (`data/textures/relief/`). A name two of
  them share fails the step: the copy is by name. `tests/bundle-content.test.ts` asserts
  `strays` is empty for every mirror over the built tree.

## CI heap budget

A workstation build is no evidence that CI can run the same step: the
catalogue job's `ubuntu-latest` runner gives Node a V8 heap of about 4 GiB,
and a step whose live data nears that fails there with `JavaScript heap out
of memory` while passing locally. So a heavy step judges itself against the
runner, not the machine it runs on. `CI_HEAP_LIMIT_BYTES`
(`heap-budget-pure.ts`) is the runner's limit, V8's 4,096 MiB old-space
default there (a Node 24 OOM log reports 4,104.1 MiB committed, as "MB");
`CI_HEAP_HEADROOM` is the share a step may use. Figures print in MiB, the
unit V8's own log uses.

**The runtime is part of the measurement.** The same `build:catalog` holds
about 45% more live heap under Node 24 than under Node 26 (measured
2026-10-30: 4,042 MiB against 2,782 MiB), so a reading taken under one
major says nothing about another. `.nvmrc` is the one place the Node
version is named: every workflow's `setup-node` reads it
(`node-version-file`), and the check fails, without judging the heap, when
the step runs under a different major. Run heavy steps locally under the
pinned Node.

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
a skipped step proves nothing. Each run costs a cold catalogue build (about
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
