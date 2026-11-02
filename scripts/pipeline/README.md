# Pipeline — the step table and the runner

One model of the build pipeline: a typed table of steps, a runner that orders
and gates them, and the content stamp as the only freshness test. This README
is the design; [Files](#files) maps it onto the code. `steps.ts` holds the
catalogue chain's `build` steps (`steps.test.ts` pins their order and edges);
every other step still runs through its own `package.json` target until it
moves onto the table.

## The model

Every producer of a file under `data/`, `public/` or `build/` that the build
or a pull depends on is a **step**. Report, draft and on-demand writers
(`sid:dr-reconcile`, `sid:risk-set`, `identity:snapshot`, and the hand-run
`build:lut` and `build:naming-parity`) are excluded by name, and
`tests/step-coverage.test.ts` holds every `declareOutputs` constant under
`scripts/` to an entry in `steps.ts`, that list, or a not-yet-migrated list
of steps a later item moves.

A step's outputs are declared once, its inputs are derived, and the order of
steps follows from which step reads which file. The runner runs the steps it
may run, checks the ones it may not, and decides freshness the same way for
all of them: hash what the step read and what it wrote, and compare with the
record of its last run.

Record lineage (`catalog/lineage/README.md`) is the companion half: the step
graph says which step made which file, lineage says why each record in it is
as it is.

Vite (`build:client`, `build:site`) is not a step. `pnpm run build` and
`pnpm run dev` run the data build through the runner, then Vite.

## Step kinds

| Kind | Runner runs it? | Record | Stale when | Today |
|---|---|---|---|---|
| `build` | yes | `build/stamps/<step>.json` (gitignored) | an input or an output hash moved | the catalogue chain, the four generators, binaries, clouds, local-group, the mirrors |
| `pull` | never | `data/stamps/<step>.json` (committed) | its request rows, a data input, its query or an output hash moved | every `refresh:*`, both `fetch:*`, the two `dustmaps` datasets |
| `bake` | never | `data/stamps/<step>.json` (committed) | an input or an output hash moved | dust, local-bubble, cloud-surfaces, textures, icons, og |

A step the runner never runs is a **manual** step. When one is stale, the
runner skips every step that reads its outputs (transitively), still builds
everything else, then exits non-zero naming each stale step's command. So
`pnpm run dev` does not start and CI fails, while unrelated layers still
rebuild.

SID allocation is not a step of its own: `build:catalog`, `build:local-group`
and the clouds stamp (`sid:stamp`) each allocate their namespaces in-process, and a failed
allocation fails that `build` step
([SID allocation](../catalog/README.md#sid-allocation)). Each appends to its
own registry partition under `data/sid/`, so every registry file has one
writer; each reads every partition's ledger and events, since SIDs are one
sequence across them ([Registry partitions](../sid/README.md#registry-partitions)).
That read is the registry loop below.

## The step table — `steps.ts`

One entry per step: `name`, `kind`, `entry` (the file the step runs) and,
for a manual step, `command` (what the stop message prints). A command is
always a `package.json` script, checked by a test, so the three pulls with no
target today (`refresh-simbad-sptype.py`, `refresh-simbad-wds-xids.py`,
`refresh-msc.py`) gain one. `package.json`
keeps one-line targets that call the runner (`build:catalog` →
`run.ts build:catalog`, `build:stamped` and `build:seed-steps` → `run.ts
data`, every build step on the table) and never names a table step's entry
file;
`util/step-inputs.ts`'s `stepEntries` reads it from `steps.ts`.

What each step **declares** and what the runner **derives**:

| Fact | TypeScript step | Python step |
|---|---|---|
| outputs | its `declareOutputs` constant, exported from a side-effect-free module (see Load-time rules) | declared in the table entry, checked against the run's recorded writes |
| code inputs | the esbuild import closure plus siblings (`util/import-closure.ts`), computed before the run | every `scripts/` module the process loaded, recorded during the run (`build_stamp.py`) |
| data inputs | the `defineSource` / `defineArtifact` constants reachable in that closure (the input-boundary design: typed readers, then source declarations) | every repo file the process opened for reading, recorded through Python's audit hook |
| order | derived: B runs after A when B reads a file A declares | declared as `after: [steps]`, checked after each run |

A `defineArtifact` is both the writer's output and the readers' source, so
`multiples.tsv` is registered once.

**Reachable must mean read.** A source reached through the closure but never
opened is not harmless: besides a spurious rebuild it adds a false ordering
edge, which can make a false cycle or skip a step behind a stale pull it never
reads. So each `defineSource` / `defineArtifact` lives in a leaf module that
only code reading that file through its typed reader imports, and a test over
each step's closure holds every reached source to a call of its reader.

The runner starts a Python step as `run_python_step.py <root> <record> <entry>`,
which runs the entry under `build_stamp.record_run`
([util/README.md](../util/README.md)); the step needs no code of its own to be
recorded.

**A recorded input set is sound for code and data alike.** A Python step
that starts reading a new module or file does so because some file it
already read changed, and that change makes it stale. That holds only for
reads Python's audit hook sees, so a Python step reads repo files only through
Python's own file calls: a subprocess or a C extension that opens a file itself
raises no event. Two reads open no file, so they need their own record:

- **Directory listings** (`os.listdir`, `os.scandir`, `glob.glob`, which
  `iterdir` and `Path.glob` go through) are audit events too; each is recorded
  as an input keyed by the directory, hashed over its sorted names, so a file
  added to a scanned folder stales the step.
- **Existence probes** (`Path.exists()`, `os.path.exists`) raise no audit
  event. A Python step probes existence only through `build_stamp.probe`,
  which records the probe; a test over the Python step modules fails on any
  other probe.

**A Python step's declarations cannot drift silently.** The audit hook also
records what the process writes: the target of every `os.rename` /
`os.replace` (so a temp-then-rename write counts as its target, not its temp
file) and every path opened for writing. A step on the runner writes no stamp
of its own: the runner writes it, so a stamp write is an undeclared one. A count
snapshot the step rewrites under `--update-snapshots` is named in its own
table field, never an output and never an ordering edge. After a Python step runs,
the runner fails the run when a recorded write is not a declared output, or
when a recorded input that another step declares as output is not covered by
`after` (directly or transitively). The two binaries steps are the only
Python `build` steps on the runner; their TypeScript ports retire both
declarations.

### Load-time rules

The runner rejects the table, before running anything, when:

- two steps declare the same output path (one writer per file, no
  exceptions);
- the derived order among `build` steps has a cycle, other than through
  the SID registry files (next paragraph);
- a `build` step's declared output is a symlink on disk (the "never symlink
  `public/`" rule becomes this check);
- a step's outputs module imports anything beyond `util/emit-artifacts`,
  `util/paths` and `*-pure` modules, checked over its import closure. That is
  what makes it side-effect-free to import, which no check can test directly.
  The walk passes through `*-outputs`, `*-source` and `*-tsv` modules too,
  checking their imports in turn: they are the only modules
  `tests/source-declarations.test.ts` lets spell a `data/` path, so a path an
  outputs module needs lives in one of them.

A manual step sits in the derived order like any other: it is checked once
the `build` steps that write its inputs have run, so a pull is judged against
the request the run just rebuilt, and its readers run only after that check,
so a stale pull is caught before anything builds on it. The one exception is
an edge from a manual step's output that would close a loop. Those back edges
are dropped, and they are exactly the kept loops (next section), which the
runner lists at load. In a kept loop the reader builds first and the pull's
check then stops the run; the reader's stamp already holds the old pull
output's hash, so it rebuilds once the pull is re-run. The cycle check
therefore never sees a loop through a manual step.

The registry loop is the one kept loop among `build` steps: `build:catalog`,
`sid:stamp` and `build:local-group` each read every registry partition, the
others' and their own. The edges dropped are exactly those whose file is a `data/sid/`
registry partition file (ledger or events) read by an allocating step, its
own partition included, named in the table as such rather than inferred,
and a test holds the dropped set to that; any other cycle still rejects
the table. No step's order among them matters: each only appends past the
union's highest SID, and the locks serialise them, since each holds a
shared lock on the others while it runs. A loop is the one place two runs
can each hold a lock the other wants, so a step takes its locks in
step-name order, its own among them. A run that mints in one stales
the others once, and that rebuild appends nothing.

## Freshness — one mechanism

A stamp is `{inputs, outputs}`, each a map of repo-relative path to content
hash (`util/build-stamp.ts`, `util/build_stamp.py`). A step is fresh when
its input set re-hashes the same and every recorded output re-hashes the
same. For a TypeScript step the input set is computed now; for a Python step
it is the recorded set, re-hashed. A missing or unparseable stamp is stale.
Hashing costs about a second per gigabyte on a warm page cache, measured over
today's stamped steps (about 1.1 GB) on a fast workstation. The runner also
re-hashes every manual step's record (`data/` is about 1.5 GB) and starts each
Python pull's `--describe` on every run; the runner core quotes a no-op data
phase before and after, warm and cold, on that machine and on a GitHub Actions
runner, which is much slower, and optimises only if that number warrants it.
Every mtime
gate goes: `build:clouds`, `build:local-group`, the mirrors and
`refresh_lib.is_up_to_date`.

A **pull's stamp** adds three fields:

- **query hash**, compared: the ADQL text or URL template, batch values
  excluded, plus the declared service list (primary and fallbacks), so
  changing which services a pull may use stales it;
- **answering service**, recorded only: Gaia pulls fall back from ESA to ARI,
  and which one answered is known only after the pull;
- **upstream release**, recorded only: no network call can read it at check
  time.

Its inputs are the request rows and the data files it read. A file the pull
reads only to work out what to ask for counts through the request it yields,
not its bytes: the SIMBAD pulls read the whole manifest to derive their keys,
so the record holds the hash of the derived request list, and an edit that
leaves the list unchanged leaves the pull fresh. The list is computed with no
network call, under `--describe`. Such a file is named in the record's
`requestFrom`, never in its inputs: it orders the pull after the file's writer,
so the pull is judged against the manifest this run rebuilt, and is never
hashed itself.

A bake follows the same rule. `cloud-surfaces` reads `public/clouds.json`
only for the geometry it traces (positions and extents), so its record holds
the hash of that projection: an SID or name change in `clouds.json` leaves it
fresh, a geometry change stops the build. The bake record is the only owner
of that fact.

An **external dataset** a baker reads from outside the repo is a pull of its
own, whose query is the dataset's identity and version: the Edenhofer 2023
dust map behind `dust` and the Edenhofer 2024 posterior behind
`cloud-surfaces`, both fetched by the `dustmaps` library into its own cache.
The audit hook records repo files only, so without that pull a new map
version would never stale either bake.
The pull's code is not an input: a refactor of the plumbing, or its port to
TypeScript, does not make a pull stale; a changed column list or `WHERE` does.
Each pull states its query as data, so the runner can hash the current query
without a network call: a TypeScript pull exports it, and a Python pull prints
it under `--describe`. The describe path imports the standard library only,
since every build runs it and a worktree has no refresh virtualenv; a test
runs each pull's `--describe` under `python3 -I -S`.

Manual-step stamps are committed because frozen data needs a committed record
of what produced it; `build/` is gitignored. One file per step, since several
write more than one file (classic-ids four, Tycho-2 two).

## The runner — `run.ts`

`run.ts <target…> [--force] [--update-snapshots] [--verify-committed]`

A target is a step name, or `data` for every build step on the table. `--verify-committed` is CI's slice of the runner and
lands with it; `run.ts` rejects it until then.

1. Load and validate the table.
2. Walk the steps the targets reach, in derived order.
   - A `build` step whose inputs include the output of a stale manual step or
     a failed step (transitively) is skipped. A step fails when it crashes,
     a check refuses its emission, or its post-run declaration check fails.
   - Any other `build` step: take its lock, then check its stamp, then run or
     skip, then release. Taking the lock before the check is what lets a run
     that waited see the fresh stamp and skip.
   - A manual step is checked, never run.
3. Exit non-zero if any manual step was stale or any step failed, naming each
   stale step's command and each failure.

- **Lock**: one per step, an operating-system file lock (`flock`) on
  `build/locks/<step>`, so the kernel releases it when the holding process
  exits, crashed or not; the file left behind is never itself the lock. A
  running step holds its own lock exclusive and a shared lock on each step
  that writes its inputs, so two runs of one step serialise, and a reader in
  one run never sees a half-replaced set (the catalogue's chunks renamed one
  by one) from a writer in another. A manual step's check holds the same
  shared locks, so a pull is never judged against a request mid-replace.
  `build-seed.sh` keeps only its
  newest-run-wins rule and relies on the locks for the rest, so a plain build
  or `dev` beside a seed run can no longer interleave with it.
- **`--force`** reaches every `build` step the run selects, uniformly. It
  never runs a manual step.
- **`--update-snapshots`** is the one way a count snapshot is rewritten: it
  sets `UPDATE_SNAPSHOTS=1` for each step it runs, the one variable
  `snapshotCheck` and `snapshot_assert.py` read. A forced rebuild therefore
  still checks counts. Every step it runs also gets `PIPELINE_STEP` set to
  its name, so a drift message names this flag rather than the variable.
- **`--verify-committed`** forces each selected step, then fails on any diff
  in its declared outputs that git tracks (`git ls-files` over the declared
  paths decides which are committed; the declaration carries no committed
  mark). It replaces `ci/catalog-stage-pure.ts`'s `CATALOG_STAGE` and
  `test.yml`'s inline build-binaries diff, and covers
  `build:astrometry-request`'s output, which nothing verifies today.
- **CI cache key**: the digest of the stage's step input sets, the same
  closure the stamps hash. `keyedPaths` stays CI's own filter over it.

## Loops through committed files

Ten places where a file feeds, directly or through other files, the step
that writes it. Measured 2026-10-27.

| Loop | Disposition |
|---|---|
| manifest → `build:wgsn` → WGSN tables → `build:membership` | Broken. The proper-name residual gate and the manifest's naming counts run in the membership gate test over the committed tables; `build:wgsn` reads no manifest. |
| manifest → astrometry request → astrometry pull → `build:membership` | Broken. The request reads `binding-review-dispositions.tsv`'s `keep_source_id`s in place of the manifest, the only ids the manifest held beyond the candidate legs. Coverage holds by measurement, so the membership gate test asserts every manifest `gaia_source_id` is in the request (a test may read the manifest; a step may not). |
| … → astrometry pull → `build:classic-ids` → overlay → `build:membership` | Broken by the row above. |
| manifest → `refresh:tycho2` → Tycho-2 → `build:membership` | Broken. Every manifest TYC is a spine-after-corrections or IV/25 TYC, and the spine adds none beyond the manifest and IV/25; the request keys on those, written as a committed TYC request file by a TypeScript `build` step (the corrected spine is computed only in TypeScript, `applySpineCorrections`) and read by both `refresh:tycho2` and `refresh:simbad-tyc-hd`. Request byte-identical. The pull's own check that every manifest TYC was pulled moves to the membership gate test, so the pull opens no manifest. |
| `simbad_sptype` → `build:binaries` → `multiples.tsv` → `build:membership` → manifest → `simbad_sptype` | Broken. Binaries reads only the WDS leg, which the manifest never moves; that leg becomes its own pull and file. |
| manifest ↔ `simbad_sptype` (the derivation's fourth binding source) | Kept. The request genuinely depends on the binding outcome. The stale-pull stop is its convergence check; re-pulling reopens the review queue, as `refresh/README.md` says. The same file also reaches the astrometry request (its derivation candidates), so manifest → `simbad_sptype` → request → astrometry pull → `build:membership` is a second path through this loop, covered by the same stop. |
| `build:binaries` ↔ its own astrometry request | Kept, same check. The request keeps rejected candidates, so it grows rather than oscillates. |
| `build:catalog` reads the SID ledger and events it appends to | Kept: an append-only file whose committed prefix the step only reads; its stamp records the post-append hash, so the next run rebuilds once and appends nothing. |
| `build:catalog` ↔ `sid:stamp` ↔ `build:local-group` through each other's registry partition (ledger and events) | Kept, the registry loop above, which also covers the row before: each reads the union for the next SID and the retired state, and appends only to its own partition. |
| `build:naming-parity` reads its own `naming-parity.tsv` | Carries frozen columns forward deliberately; not a pipeline step. |

## Derived checks

Hand-kept lists become derivations over the table:

- `tests/artifact-freshness.test.ts` iterates every stamp in `build/stamps/`
  and `data/stamps/`.
- `.worktreeinclude` may list only the `build` steps' stamped outputs, their
  stamp files and `build/lineage/`, and must list every stamped output and
  stamped family under `public/` or `build/`. `worktree-seed.test.ts` checks it against
  the outputs and stamps of the steps `build:seed-steps` selects, read from
  the loaded step table.
- `tests/bundle-content.test.ts` reads the mirror steps' declarations.
- `resolved-hole-table.ts`'s record count is tested against
  `build-catalog-expected.json`'s `recordCount`.

## Migration

- **Bootstrap.** One commit writes `data/stamps/<step>.json` for every pull
  and baker from today's request files, data inputs and the query text in
  today's code, adopting today's committed outputs as fresh. The lineage
  invariants (`../catalog/lineage/README.md#invariants`) vouch for
  Bailer-Jones (`placement.distance.bailer-jones-absent`) and the
  derivation's candidates (`membership.binding.unweighed-no-pulled-row`), and
  the `gateSkippedNoGMag` zero-pin for the overlay gate's; Apsis and GSPC carry residual pins, which cannot
  show a stale request, and the SIMBAD, Tycho-2, binaries-astrometry and DR2
  neighbourhood pulls carry none, so those are adopted unverified. A baker's first
  record takes its inputs from today's hand list; its next run replaces them
  with the recorded set.
- **Order.** Runner core, then the stamped steps and the four generators, then
  the mtime steps and mirrors (after clouds sets SIDs in its own record, as
  local-group does, so no step rewrites another's output, and after clouds' port
  to TypeScript, so it reaches the runner as a TypeScript step), then CI's
  `--verify-committed`, then the derived checks. The four loop breaks ship
  with the slice that moves their step.

## Files

- `step-table-pure.ts` (+ test) — the table's types (`StepEntry`, one
  variant per kind and language), the load-time rules that need no disk
  (one writer per output, files against families included, and two families
  in one folder only when both list names and none is shared; a build-step
  cycle; an `after` naming no step), and `deriveGraph`: read edges, the
  registry edges set aside, a manual step's back edges kept as loops, and
  the run order (table order breaks ties). `selectSteps` is a target plus
  everything upstream, kept loops included; `writersOf` names the steps a
  step takes shared locks on.
- `run_python_step.py` — a Python step's command line under the recorder.
- `locks.ts` (+ test) / `lock_holder.py` — `holdLocks` starts a
  `lock_holder.py` child that takes each `flock` (Node has none) in
  step-name order and holds them until its stdin closes, so the locks go
  when the run exits however it exits. A holder that dies while its step
  runs has lost the locks with it, so the runner fails that step. `lockSpecs`
  is that order. A lock
  file is `build/locks/<step>`, `:` written `-` (`util/build-stamp.ts`'s
  `stepFileName`, which names the step's stamp too).
- `load-table.ts` — `loadTable`: checks every TypeScript outputs module's
  imports before importing any, imports the `declareOutputs` constants, rejects a build output
  through a symlink (the path or any folder above it, up to the root), reads
  each manual step's record for its inputs, then `deriveGraph`. A
  TypeScript step's inputs come from the injected `deriveInputs`;
  `run.ts` passes `util/step-inputs.ts`'s `entryInputPaths`.
- `freshness.ts` — the one stamp test per kind: a TypeScript build's inputs
  derived now, a Python build's recorded inputs, listings and probes
  re-hashed, a manual step's committed record plus, for a pull, its
  `--describe` (`describePull`, run under `python3 -I -S`) hashed as
  `pullQueryHash` (query text and service list) and `requestHash` (the
  derived request list). Every kind is also stale when a recorded output
  moved or a declared output is missing from the record. Writers of a pull's
  record use the same two hash functions.
- `python-run-pure.ts` (tested through `runner.test.ts`) — `recordProblems`: a
  write outside the declared outputs and snapshots, or a read, listing or
  probe of another step's output with no path from that step in the graph.
- `runner.ts` (+ test) — `runSteps`: the walk of [The runner](#the-runner--runts)
  over a loaded table, the `Verdict` union (`fresh`, `built`, `stale`,
  `failed`, `skipped`) matched exhaustively, and the exit status. The runner
  writes every build stamp itself once a step exits 0 and its declared
  outputs exist: inputs hashed before the run, those it also wrote (and,
  under `--update-snapshots`, all of a TypeScript step's) re-hashed after.
  `pipeline-tree.ts` is the run's one root: table paths resolve against it,
  stamp keys are relative to it, and a step's build stamp (through
  `stampPath`), manual record, run record and lock folder sit under it.
  `run.ts` passes the repo root; tests pass a temporary folder.
- `run.ts` / `steps.ts` — the command line and the table it runs.

## Design pass

- **Q1, one owner per fact.** Step order: the data flow. Outputs: each step's
  declaration. Code inputs: the import closure (TS) or the run record
  (Python). Data inputs: the source constants (TS) or the run record (Python).
  Freshness: the stamp. Force and snapshot updating: two runner flags.
  Committed-output verification: one runner mode.
- **Q2, wrong states.** Fresh, stale, failed and skipped-behind-a-stale-or-
  failed-step are the variants of one verdict union the runner matches on
  exhaustively; a missing stamp reads as stale, never fresh.
- **Q3, when it is true.** A stamp is written only after the step's checks
  pass and its outputs land (`emitArtifacts`); the lock is taken before the
  stamp is read.
- **Q6, the force.** One table absorbs 3 stamped steps, 2 emitters, 6
  mirrors, 3 CI-only generators and 1 that runs nowhere, 24 pulls (19
  `refresh:*` targets, 3 untargeted scripts, 2 `fetch:*`; 25 after the
  `simbad_sptype` split, plus the two `dustmaps` datasets) and 6 bakers.
  Step kinds exist because two runner behaviours (run it; check it and stop)
  each hold several cases today.
- **Q7, copies.** The two stamp helpers stay one per language with one JSON
  shape; `refresh_lib.is_up_to_date`, the mtime gates, `CATALOG_STAGE` and
  the inline YAML diff are deleted, not wrapped.
