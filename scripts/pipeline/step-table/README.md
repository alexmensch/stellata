# Step table — what each step declares and how the table loads

The table half of the pipeline model ([../README.md](../README.md)): the
entries, what a step declares against what the runner derives, how a Python
step's run is recorded and checked, and the rules that reject a table before
anything runs. The runner, freshness and `record.ts` stay in the parent
folder and import from here.

## The step table — `steps.ts`

One entry per step: `name`, `kind`, `language`, `entry` (the file the step
runs) and its outputs. A manual step is named for its `package.json` script,
which is what the stop message prints and what runs it by hand, so the three
pulls with no target before (`refresh-simbad-sptype.py`,
`refresh-simbad-wds-xids.py`, `refresh-msc.py`) gain one. A TypeScript manual
step, pull or bake (`manual-step-outputs.ts`'s `tsManual`; the two Horizons
fetchers today), names its `declareOutputs` constant as a TypeScript build
does, and one that describes itself exports `describe`
([util/README.md](../../util/README.md), `emit-artifacts.ts` entry); a Python
one lists its files, plus any families.
`package.json` keeps one-line targets that call the runner (`build:catalog` →
`run.ts build:catalog`, `build:data` → `run.ts
data`, every build step on the table) or `record.ts` (every manual step), and
never names a table step's entry file; `util/step-inputs.ts`'s `stepEntries`
reads it from `steps.ts`.

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
([util/README.md](../../util/README.md)); the step needs no code of its own to be
recorded.

**A recorded input set is sound for code and data alike.** A Python step
that starts reading a new module or file does so because some file it
already read changed, and that change makes it stale. That holds only for
reads Python's audit hook sees, so a Python step reads repo files only through
Python's own file calls: a subprocess or a C extension that opens a file itself
raises no event. Two reads open no file, so they need their own record:

- **Directory listings** (`os.listdir`, `os.scandir`, `glob.glob`, which
  `iterdir` and `Path.glob` go through) are audit events too; each is recorded
  as an input keyed by the directory, hashed over its sorted names less the
  ones git ignores, so a file added to a scanned folder stales the step and a
  local cache beside it does not. A listed folder git ignores (under
  `public/` or `build/`, other steps' outputs) is no input at all
  (`util/build-stamp.ts`'s `listingHashes`).
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
`after` (directly or transitively). A pull named in `after` whose edge closes
a loop is a kept loop ([Loops through committed files](../README.md#loops-through-committed-files))
and covers its own outputs only, never a step
reached through it. The converse fails it too: an `after` entry none of
whose outputs the run read, listed or probed is a false ordering edge
(Reachable must mean read, above). `build:binaries` is the only Python
`build` step on the runner; its TypeScript port retires these
declarations.

## Load-time rules

The runner rejects the table, before running anything, when:

- two steps declare the same output path (one writer per file, no
  exceptions);
- the derived order among `build` steps has a cycle, other than through
  the SID registry files (the registry loop, below);
- a `build` step's declared output is a symlink on disk (the "never symlink
  `public/`" rule becomes this check);
- a step's outputs module reaches, over its import closure, a module beyond
  `util/emit-artifacts`, `util/paths` and the two boundary trees
  (`src/catalog-format/**`, `src/astro-core/**`, as `util/source-trees.ts`
  roots them). A filename suffix grants nothing: a name an outputs module
  declares lives in the format tree (`/src/catalog-format/pipeline-outputs/`
  for the files the viewer never fetches), and the module that reads or
  writes the file imports it from there;
- a module that loading imports could act on import: an outputs module or
  one the walk accepts imports a package, a Node built-in other than
  `node:path` and `node:crypto`, or awaits at top level. The two leaves and
  what they import may use any built-in (they touch `node:fs` only inside
  functions) but no package and no top-level await. Without file, network or
  process modules, importing does no I/O; what no import check sees is a
  global (`fetch`, `process`) and an `import()` of a computed name.

A manual step sits in the derived order like any other: it is checked once
the `build` steps that write its inputs have run, so a pull is judged against
the request the run just rebuilt, and its readers run only after that check,
so a stale pull is caught before anything builds on it. The one exception is
an edge from a manual step's output that would close a loop. Those back edges
are dropped, and they are exactly the kept loops
([Loops through committed files](../README.md#loops-through-committed-files)), which the
runner lists at load. In a kept loop the reader builds first and the pull's
check then stops the run; the reader's stamp already holds the old pull
output's hash, so it rebuilds once the pull is re-run. The cycle check
therefore never sees a loop through a manual step.

The registry loop is the one kept loop among `build` steps: `build:catalog`,
`build:clouds` and `build:local-group` each read every registry partition, the
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

## Files

- `step-table-pure.ts` (+ test) — the table's types (`StepEntry`, one
  variant per kind and language), the load-time rules that need no disk
  (one writer per output, files against families included, and two families
  in one folder only when both list names and none is shared; a build-step
  cycle; an `after` naming no step), and `deriveGraph`: edges (`reads`, a
  reader's files, or `after`, a Python step's declaration), the
  registry edges set aside, a manual step's back edges kept as loops, and
  the run order (table order breaks ties). `selectSteps` is a target plus
  everything upstream, kept loops included; `writersOf` names the steps a
  step takes shared locks on.
- `load-table.ts` — `loadTable`: checks every
  TypeScript outputs module's imports (`walkOutputsModules`, its import-time
  rule `importTimeProblems`) before importing any, imports the `declareOutputs` constants, rejects a build output
  through a symlink (the path or any folder above it, up to the root), reads
  each manual step's record for its inputs and the files it projects
  (`requestFrom`), so a pull or bake orders after their writers, then
  `deriveGraph`. A
  TypeScript step's inputs come from the injected `deriveInputs`, so a
  fixture table can load under a temporary root.
- `repo-table.ts` — the repo's table loaded against this checkout, its
  `deriveInputs` `util/step-inputs.ts`'s `entryInputPaths`: `loadRepoTable`
  for `run.ts` and `record.ts`, `loadedRepoTable` (a rejected table throws)
  for the suites that read the real table — `steps.test.ts`,
  `.worktreeinclude`'s generator (`../worktree-include.ts`),
  `/tests/artifact-freshness.test.ts`.
- `manual-step-outputs.ts` — `MANUAL_STEPS`, every pull and bake with the
  files it writes, as an outputs module. Which modules may spell a `data/`
  path is `/tests/source-declarations.test.ts`'s rule.
- `non-step-writers.ts` — `NON_STEP_WRITERS`, the one list of the
  `package.json` scripts named or shaped like steps that are not on the
  table, each with its kind (`report`, `draft`, `on-demand`, `vite`, `seed`)
  and a writer's `declareOutputs` constants; `closureReadingWriters` are the
  report and on-demand ones, whose closures `/tests/source-declarations.test.ts`
  holds to the source rules like a step's. `/tests/step-coverage.test.ts`
  holds every declaration and step-named script to the table or this list.
  `outputsOwners(table)` is every TypeScript outputs declaration the two
  name, with its owner, which both that test and
  `/tests/step-outputs.test.ts` read.
- `steps.ts` (+ test) — the table `run.ts` and `record.ts` load, its manual
  steps `MANUAL_STEPS` and its six mirrors `MIRROR_STEPS` (one `mirrorStep(layer)`
  each: `scripts/<layer>/sync-<layer>.ts` over `<layer>-mirror-outputs.ts`'s
  `MIRROR_OUTPUTS`).
  The test holds the table to the load-time rules, every TypeScript step's
  import closure clear of `util/step-inputs.ts` (a step takes its input
  hashes from the runner, `util/step-input-hashes.ts`), each mirror's family
  folders to that mirror alone (`strays()` deletes anything else there), every manual step's
  `package.json` target to `record.ts <name>` through the launcher, and every
  pull's and describing bake's `--describe` to running (Python under
  `python3 -I -S`, TypeScript through `tsx` and the launcher; skipped while the manifest is
  an unsmudged LFS pointer, or before `build:clouds` has written
  `public/clouds.json`).
