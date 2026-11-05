# Pipeline — the step table and the runner

One model of the build pipeline: a typed table of steps, a runner that orders
and gates them, and the content stamp as the only freshness test. This README
is the design; [Files](#files) maps it onto the code. `step-table/steps.ts` holds every
`build` step (`steps.test.ts` pins their order and edges; `MIRROR_STEPS`
the six mirrors) and every pull and bake (`MANUAL_STEPS`, each run by hand
through `record.ts`, the two Horizons fetchers among them).

## The model

Every producer of a file under `data/`, `public/` or `build/` that the build
or a pull depends on is a **step**. Report, draft and on-demand writers
(`sid:dr-reconcile`, `sid:risk-set`, `identity:snapshot`, and the hand-run
`build:lut` and `build:naming-parity`) are excluded by name, and
`tests/step-coverage.test.ts` holds every `declareOutputs` constant under
`scripts/` to an entry in `steps.ts` or that list.

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
| `pull` | never | `data/stamps/<step>.json` (committed) | its request rows, a data input, its query or an output hash moved | every `refresh:*` (the two Edenhofer variants among them); both `fetch:*` |
| `bake` | never | `data/stamps/<step>.json` (committed) | an input or an output hash moved | dust, local-bubble, cloud-surfaces, textures, icons, og |

A step the runner never runs is a **manual** step. When one is stale, the
runner skips every step that reads its outputs (transitively), still builds
everything else, then exits non-zero naming each stale step's command. So
`pnpm run dev` does not start and CI fails, while unrelated layers still
rebuild.

SID allocation is not a step of its own: `build:catalog`, `build:local-group`
and `build:clouds` each allocate their namespaces in-process, and a failed
allocation fails that `build` step
([SID allocation](../catalog/README.md#sid-allocation)). Each appends to its
own registry partition under `data/sid/`, so every registry file has one
writer; each reads every partition's ledger and events, since SIDs are one
sequence across them ([Registry partitions](../sid/README.md#registry-partitions)).
That read is the registry loop ([Load-time rules](step-table/README.md#load-time-rules)).

## The step table

[step-table/README.md](step-table/README.md): what each step declares and
what the runner derives, how a Python step's run is recorded and checked
(listings, probes, writes, `after`), and the load-time rules, the kept-loop
back edges and the registry loop among them.

## Freshness — one mechanism

A stamp is `{inputs, outputs}`, each a map of repo-relative path to content
hash (`util/build-stamp.ts` over `util/stamp-hash.ts`, `util/build_stamp.py`). An input that is code
hashes as its token stream without comments or docstrings
(`util/code-identity.ts`), so an edit that cannot change
what a step computes leaves it fresh; an output hashes as bytes. A step is fresh when
its input set re-hashes the same and every recorded output re-hashes the
same. For a TypeScript step the input set is computed now; for a Python step
it is the recorded set, re-hashed. A missing or unparseable stamp is stale.
Hashing costs about a second per gigabyte on a warm page cache, measured over
today's stamped steps (about 1.1 GB) on a fast workstation. The runner also
re-hashes every manual step's record (`data/` is about 1.5 GB) and starts each
Python pull's `--describe` on every run; the runner core quotes a no-op data
phase before and after, warm and cold, on that machine and on a GitHub Actions
runner, which is much slower, and optimises only if that number warrants it.

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
only for the geometry it traces (positions and extents) and the SID it keys
each surface by, so its record holds the hash of that projection: a name
change in `clouds.json` leaves it fresh, a geometry or SID change stops the
build. The bake record is the only owner of that fact.

An **external dataset** a baker reads from outside the repo is a pull of its
own, whose query is the dataset's identity and version: the two variants of
the [Edenhofer 2024](/data/papers/index.md#edenhofer2024) map (one Zenodo
record), `main` behind `dust` and both behind `cloud-surfaces`, fetched by
the `dustmaps` library into its own cache
([The Edenhofer 2024 pulls](../dust/README.md#the-edenhofer-2024-pulls)).
The audit hook records repo files only, so without that pull a new map
version would never stale either bake.
The pull's code is not an input: a refactor of the plumbing, or its port to
TypeScript, does not make a pull stale; a changed column list or `WHERE` does.
Each pull states its query as data, so the runner can hash the current query
without a network call: every pull prints it under `--describe` (a
TypeScript pull through `runStep(main, describe)`). A Python pull's describe
path imports the standard library only, since every build runs it and a
worktree has no refresh virtualenv (`steps.test.ts`, [step-table/README.md](step-table/README.md#files)).

Manual-step stamps are committed because frozen data needs a committed record
of what produced it; `build/` is gitignored. One file per step, since several
write more than one file (classic-ids four, Tycho-2 two).

## The runner — `run.ts`

`run.ts <target…> [--force] [--update-snapshots] [--verify-committed]`

A target is a step name, or `data` for every build step on the table.

1. Load and validate the table.
2. Walk the steps the targets reach, in derived order.
   - A `build` step whose inputs include the output of a stale manual step or
     a failed step (transitively) is skipped. A step fails when it crashes,
     a check refuses its emission, or its post-run declaration check fails.
   - Any other `build` step: take its lock, then check its stamp, then run or
     skip, then release. Taking the lock before the check is what lets a run
     that waited see the fresh stamp and skip.
   - A manual step is checked, never run. A check whose `--describe`
     cannot run (the file it projects is missing) fails the step.
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
  reruns each named target even when fresh (not the fresh steps upstream),
  and sets `UPDATE_SNAPSHOTS=1` for each step it runs, the one variable
  `snapshotCheck` and `snapshot_assert.py` read. A forced rebuild therefore
  still checks counts. Every step it runs also gets `PIPELINE_STEP` set to
  its name, so a drift message names this flag rather than the variable.
- **`--verify-committed`** fails a step, fresh or built, whose declared
  outputs git tracks and whose working copy differs from the index, naming
  the files and the command; its readers are skipped as behind any failure.
  Git decides which outputs are committed; the declaration carries no
  committed mark. It does not force: a fresh step's stamp already vouches
  that its outputs are what its inputs build, since a committed output that
  differs from the recorded hash stales the step, and the rebuild then
  shows the diff. With `--force` every selected step is rebuilt first. CI
  runs it over `data` on every push, forced on main
  ([The data build cache](../ci/README.md#the-data-build-cache)).

## Recording a manual step — `record.ts`

`record.ts <step> [--force] [args…]` is every pull's and bake's
`package.json` target, so a hand re-run is what keeps its record fresh. It
takes the step's lock, and the shared locks on the steps writing its inputs,
as the runner does; skips a step whose record is fresh unless `--force`;
describes it; runs it (a Python step under `build_stamp.record_run`, a
TypeScript one through `tsx`, its inputs derived and hashed before the run, as a TypeScript build's
are); then writes `data/stamps/<step>.json` with `writeManualRecord`. Extra
arguments pass through to the step (`--only <stem>`, `--dry-run`,
`--synthetic`), which then always runs but writes no record: a partial or
non-standard run cannot vouch for the whole step, so whatever it moved
reads stale until a plain run.

The record counts as read every file the run read, listed or probed, except
its own outputs, a file named in `requestFrom` (it counts through the
request), an ignored file (a `.ckpt` batch cache, the dust bake's
`.voxels-*.npy`: no other checkout has one, so no listing counts it either),
and, for a pull, code. An ignored
write is scratch; any other write the step does not declare fails the run
and leaves the record as it was. `answeredBy` is the run record's services,
in first-answer order; `release` is the description's.

## Loops through committed files

Ten places where a file feeds, directly or through other files, the step
that writes it. Measured 2026-10-27.

| Loop | Disposition |
|---|---|
| manifest → `build:wgsn` → WGSN tables → `build:membership` | Broken. The proper-name residual gate and the manifest's naming counts run in the membership gate test over the committed tables; `build:wgsn` reads no manifest. |
| manifest → astrometry request → astrometry pull → `build:membership` | Broken. The request reads `binding-review-dispositions.tsv`'s `keep_source_id`s in place of the manifest, the only ids the manifest held beyond the candidate legs. Coverage holds by measurement, so the membership gate test asserts every manifest `gaia_source_id` is in the request (a test may read the manifest; a step may not). |
| … → astrometry pull → `build:classic-ids` → overlay → `build:membership` | Broken by the row above. |
| manifest → `refresh:tycho2` → Tycho-2 → `build:membership` | Kept until broken: both pulls still key on the manifest. The break: every manifest TYC is a spine-after-corrections or IV/25 TYC, and the spine adds none beyond the manifest and IV/25; the request keys on those, written as a committed TYC request file by a TypeScript `build` step (the corrected spine is computed only in TypeScript, `applySpineCorrections`) and read by both `refresh:tycho2` and `refresh:simbad-tyc-hd`. Request byte-identical. The pull's own check that every manifest TYC was pulled moves to the membership gate test, so the pull opens no manifest. |
| `simbad_sptype` → `build:binaries` → `multiples.tsv` → `build:membership` → manifest → `simbad_sptype` | Kept until broken: binaries still reads `simbad_sptype.tsv`, so `build:binaries` names `refresh:simbad-sptype` in `after`. The break: binaries reads only the WDS leg, which the manifest never moves, once that leg is its own pull and file. |
| manifest ↔ `simbad_sptype` (the derivation's fourth binding source) | Kept. The request genuinely depends on the binding outcome. The stale-pull stop is its convergence check; re-pulling reopens the review queue, as `refresh/README.md` says. The same file also reaches the astrometry request (its derivation candidates), so manifest → `simbad_sptype` → request → astrometry pull → `build:membership` is a second path through this loop, covered by the same stop. |
| `build:binaries` ↔ its own astrometry request | Kept, same check. The request keeps rejected candidates, so it grows rather than oscillates. |
| `build:catalog` reads the SID ledger and events it appends to | Kept: an append-only file whose committed prefix the step only reads; its stamp records the post-append hash, so the next run rebuilds once and appends nothing. |
| `build:catalog` ↔ `build:clouds` ↔ `build:local-group` through each other's registry partition (ledger and events) | Kept, the registry loop ([Load-time rules](step-table/README.md#load-time-rules)), which also covers the row before: each reads the union for the next SID and the retired state, and appends only to its own partition. |
| `build:naming-parity` reads its own `naming-parity.tsv` | Carries frozen columns forward deliberately; not a pipeline step. |

## Derived checks

Hand-kept lists become derivations over the table:

- `tests/artifact-freshness.test.ts` iterates every stamp in `build/stamps/`
  and `data/stamps/`.
- `.worktreeinclude` is generated (`pnpm run worktree:include`) from the
  steps `build:data` selects in the loaded table: each one's declared files
  under `public/` or `build/` (`build/lineage/` among them), its stamped
  families there and its stamp, sorted. `worktree-include.test.ts`
  regenerates it and fails on any difference, so a step added to the table
  is seeded once the command is re-run.
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
  the mtime steps and mirrors (clouds and local-group are TypeScript and each
  sets SIDs in its own record, so no step rewrites another's output), then CI's
  `--verify-committed`, then the derived checks. The four loop breaks ship
  with the slice that moves their step.

## Files

The table's own files are in [step-table/](step-table/README.md#files).

- `run_python_step.py` — a Python step's command line under the recorder.
- `locks.ts` (+ test) / `lock_holder.py` — `holdLocks` starts a
  `lock_holder.py` child that takes each `flock` (Node has none) in
  step-name order and holds them until its stdin closes, so the locks go
  when the run exits however it exits. A holder that dies while its step
  runs has lost the locks with it, so the runner fails that step. `lockSpecs`
  is that order; `holdStepLocks` takes a step's locks within a loaded table,
  for the runner and `record.ts` alike. A lock
  file is `build/locks/<step>`, `:` written `-` (`util/stamp-path-pure.ts`'s
  `stepFileName`, which names the step's stamp too).
- `freshness.ts` (+ test) — the one stamp test per kind: a TypeScript
  build's inputs derived now, a Python build's recorded inputs, listings and
  probes re-hashed, a manual step's committed record plus, for a step that
  describes itself (every pull, and a bake that reads a projection), its
  `--describe` (`describeStep`: `python3 -I -S`, or `tsx` for a TypeScript
  step), parsed into a `Description` and hashed as `pullQueryHash` (query text
  and service list) and `requestHash` (the derived request list). Every kind
  is also stale when a recorded output moved or a declared output is missing
  from the record. `buildFreshness` is a build step's verdict, the runner's
  and `tests/artifact-freshness.test.ts`'s alike. `writeManualRecord` is
  `readManualRecord`'s encoder, the one writer of `data/stamps/`.
- `python-run-pure.ts` (tested through `runner.test.ts`) — `recordProblems`: a
  write outside the declared outputs and snapshots, or a read, listing or
  probe of another step's output with no path from that step in the graph
  and no kept loop from it straight to the reader, or an `after` entry the
  run touched none of the outputs of.
- `runner.ts` (+ test) — `runSteps`: the walk of [The runner](#the-runner--runts)
  over a loaded table, the `Verdict` union (`fresh`, `built`, `stale`,
  `failed`, `skipped`) matched exhaustively, and the exit status. The runner
  writes every build stamp itself once a step exits 0 and its declared
  outputs exist: inputs hashed before the run, those it also wrote (and,
  under `--update-snapshots`, all of a TypeScript step's) re-hashed after.
  `pipeline-tree.ts` is the run's one root: table paths resolve against it,
  stamp keys are relative to it, and a step's build stamp (through
  `stampPath`), manual record, run record, handed inputs and lock folder sit under it.
  `run.ts` passes the repo root; tests pass a temporary folder.
- `run.ts` — the command line over `step-table/steps.ts`. Under GitHub
  Actions it also writes `built=true|false` (whether any step built) to
  `GITHUB_OUTPUT`, which gates CI's save.
- `build-files.ts` (tested through `runner.test.ts`) — `buildClaims`, the
  one statement of what a build step owns: its declared files, families and
  stamp. `buildFiles` is those that exist on disk, family members expanded,
  which is the set CI caches
  ([The data build cache](../ci/README.md#the-data-build-cache)).
- `worktree-include-pure.ts` (+ test) / `worktree-include.ts` (+ test) /
  `write-worktree-include.ts` — `.worktreeinclude`'s generator
  ([Derived checks](#derived-checks)). A family listing its names is
  written name by name; one with a pattern, as the glob `memberGlob` reads
  from it: each run of regex syntax becomes `*`, so the glob matches every
  member and a few names more (`catalog.bin.*`). A pattern it cannot read
  that way (unanchored, flagged, a top-level `|`, a literal glob metacharacter)
  throws rather than guess. `seedSteps` is `build:data`'s selection.
- `record.ts` / `record-step.ts` (+ test) — [Recording a manual
  step](#recording-a-manual-step--recordts): `recordStep` and the
  `RecordOutcome` union (`fresh`, `recorded`, `failed`).
- `processes.ts` — how the runner and `record.ts` start a step: `runTs`, a
  TypeScript step under `tsx`, handed the input hashes taken before it
  started (`util/step-input-hashes.ts`), or `runRecorded`, a Python step
  under the recorder, whose run record is read only when it exits 0.

## Design pass

- **Q1, one owner per fact.** Step order: the data flow. Outputs: each step's
  declaration. Code inputs: the import closure (TS) or the run record
  (Python). Data inputs: the source constants (TS) or the run record (Python).
  Freshness, locally and in CI's cache: the stamp. Force, snapshot updating
  and committed-output verification: three runner flags.
- **Q2, wrong states.** Fresh, stale, failed and skipped-behind-a-stale-or-
  failed-step are the variants of one verdict union the runner matches on
  exhaustively; a missing stamp reads as stale, never fresh.
- **Q3, when it is true.** A stamp is written only after the step's checks
  pass and its outputs land (`emitArtifacts`); the lock is taken before the
  stamp is read.
- **Q6, the force.** One table absorbs 3 stamped steps, 2 emitters, 6
  mirrors, 3 CI-only generators and 1 that runs nowhere, 26 pulls (24
  `refresh:*`, two of them the Edenhofer variants, and 2 `fetch:*`, all in
  `MANUAL_STEPS`) and 6 bakes; recount with
  `MANUAL_STEPS.filter((s) => s.kind === 'pull').length`.
  Step kinds exist because two runner behaviours (run it; check it and stop)
  each hold several cases today.
- **Q7, copies.** The two stamp helpers stay one per language with one JSON
  shape, and CI keys no input set of its own.
