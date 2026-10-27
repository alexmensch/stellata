# Pipeline — the step table and the runner

One model of the build pipeline: a typed table of steps, a runner that orders
and gates them, and the content stamp as the only freshness test. This README
is the design; `steps.ts` and `run.ts` land in this folder to implement it.

## The model

Every producer of a file under `data/`, `public/` or `build/` is a **step**.
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
| `pull` | never | `data/stamps/<step>.json` (committed) | its request rows, a data input, its query or an output hash moved | every `refresh:*`, both `fetch:*` |
| `bake` | never | `data/stamps/<step>.json` (committed) | an input or an output hash moved | dust, local-bubble, cloud-surfaces, textures, icons, og |
| `allocate` | never | the SID ledger itself | `allocate.ts --check` finds a record to mint or an orphaned synthetic key | `sid:allocate` |

A step the runner never runs is a **manual** step. When one is stale, the
runner skips every step that reads its outputs (transitively), still builds
everything else, then exits non-zero naming each stale step's command. So
`pnpm run dev` does not start and CI fails, while unrelated layers still
rebuild.

`allocate` is gated on a predicate rather than a hash because its input is
the whole built catalogue: a hash would call it stale after every catalogue
change, whether or not a new record needs an SID. A predicate keeps no
record, so `allocate` is the one manual step with no `data/stamps/` file.
The predicate is `allocate.ts --check`'s own walk, the one owner of SID
health: `build:catalog` lands its artifacts and stamp with a record lacking an
SID rather than failing, and the allocate check then stops the run with one
message per cause — `pnpm run sid:allocate` for a record to mint, the same-as
bridge or retirement for an orphaned synthetic key. Minting an SID stays a
deliberate act; a branch build never appends to the ledger.

## The step table — `steps.ts`

One entry per step: `name`, `kind`, `entry` (the file the step runs) and,
for a manual step, `command` (what the stop message prints). `package.json`
keeps one-line targets that call the runner (`build:data` →
`run.ts data`); it no longer names step entry files, so
`import-closure-pure.ts`'s `tsxEntry` reads `steps.ts` instead.

What each step **declares** and what the runner **derives**:

| Fact | TypeScript step | Python step |
|---|---|---|
| outputs | its `declareOutputs` constant, exported from a side-effect-free module (`catalog/catalog-outputs.ts` is the shape) | declared in the table entry, checked against the run's recorded writes |
| code inputs | the esbuild import closure plus siblings (`util/import-closure.ts`), computed before the run | every `scripts/` module the process loaded, recorded during the run (`build_stamp.py`) |
| data inputs | the `defineSource` / `defineArtifact` constants reachable in that closure (the input-boundary design: typed readers, then source declarations) | every repo file the process opened for reading, recorded through Python's audit hook |
| order | derived: B runs after A when B reads a file A declares | declared as `after: [steps]`, checked after each run |

A `defineArtifact` is both the writer's output and the readers' source, so
`multiples.tsv` is registered once.

**Reachable must mean read.** A source reached through the closure but never
opened is not harmless: besides a spurious rebuild it adds a false ordering
edge, which can make a false cycle or skip a step behind a stale pull it never
reads. (Today `build:wgsn` reaches the manifest's path through a parse helper
in the manifest module, and `build:catalog`'s parked-ledger path besides.) So
each `defineSource` / `defineArtifact` lives in a leaf module that only code
reading that file through its typed reader imports, and a test over each
step's closure holds every reached source to a call of its reader.

**A recorded input set is sound for code and data alike.** A Python step
that starts reading a new module or file does so because some file it
already read changed, and that change makes it stale. Two reads open no file,
so they need their own record:

- **Directory listings** (`os.listdir`, `os.scandir`, `glob.glob`, which
  `iterdir` and `Path.glob` go through) are audit events too; each is recorded
  as an input keyed by the directory, hashed over its sorted names, so a file
  added to a scanned folder stales the step.
- **Existence probes** (`Path.exists()`, `os.path.exists`) raise no audit
  event. A Python step probes existence only through the stamp helper, which
  records the probe; a test over the Python step modules fails on any other
  probe.

**A Python step's declarations cannot drift silently.** The audit hook also
records what the process writes: the target of every `os.rename` /
`os.replace` (so a temp-then-rename write counts as its target, not its temp
file) and every path opened for writing, less the step's own stamp. A count
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
- the derived order among `build` steps has a cycle;
- a `build` step's declared output is a symlink on disk (the "never symlink
  `public/`" rule becomes this check);
- a step's outputs module imports anything beyond `util/emit-artifacts`,
  `util/paths` and `*-pure` modules, checked over its import closure. That is
  what makes it side-effect-free to import, which no check can test directly;
  each `*_OUTPUTS` constant moves to such a sibling module, and a path
  constant it needs moves into one (`catalog-outputs.ts` imports the parked
  and SIMBAD-sourced ledger paths from their non-pure modules today).

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

## Freshness — one mechanism

A stamp is `{inputs, outputs}`, each a map of repo-relative path to content
hash (`util/build-stamp.ts`, `util/build_stamp.py`). A step is fresh when
its input set re-hashes the same and every recorded output re-hashes the
same. For a TypeScript step the input set is computed now; for a Python step
it is the recorded set, re-hashed. A missing or unparseable stamp is stale.
Hashing costs about a second per gigabyte on a warm page cache. Every mtime
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
network call, under `--describe`.
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
  exits, crashed or not; the file left behind is never itself the lock. Two
  runs of one step serialise. `build-seed.sh` keeps only its newest-run-wins rule and relies on
  the lock for the rest, so a plain build or `dev` beside a seed run can no
  longer interleave writes to `public/catalog.bin.*`.
- **`--force`** reaches every `build` step the run selects, uniformly. It
  never runs a manual step.
- **`--update-snapshots`** is the one way a count snapshot is rewritten. It
  replaces `UPDATE_BUILD_COUNTS` and `UPDATE_DISTANCE_OUTLIERS`, and the
  Python steps honour it too. A forced rebuild therefore still checks counts.
- **`--verify-committed`** forces each selected step, then fails on any diff
  in its declared outputs that git tracks (`git ls-files` over the declared
  paths decides which are committed; the declaration carries no committed
  mark). It replaces `ci/catalog-stage-pure.ts`'s `CATALOG_STAGE` and
  `test.yml`'s inline build-binaries diff, and covers
  `build:astrometry-request`'s output, which nothing verifies today.
- **CI cache key**: the digest of the stage's step input sets, the same
  closure the stamps hash. `keyedPaths` stays CI's own filter over it.

## Loops through committed files

Nine places where a file feeds, directly or through other files, the step
that writes it. Measured 2026-10-27.

| Loop | Disposition |
|---|---|
| manifest → `build:wgsn` → WGSN tables → `build:membership` | Broken. `build:wgsn` reads the manifest only for its proper-name residual gate and three counts; those move to the membership gate test. Outputs unchanged. |
| manifest → astrometry request → astrometry pull → `build:membership` | Broken. The request's manifest leg adds exactly 30 ids beyond the candidate legs, all of them `keep_source_id`s in `binding-review-dispositions.tsv`; the request reads that file instead. Request byte-identical. That coverage now holds by measurement, so the membership gate test asserts every manifest `gaia_source_id` is in the request (a test may read the manifest; a step may not). |
| … → astrometry pull → `build:classic-ids` → overlay → `build:membership` | Broken by the row above. |
| manifest → `refresh:tycho2` → Tycho-2 → `build:membership` | Broken. Every manifest TYC is a spine-after-corrections or IV/25 TYC, and the spine adds none beyond the manifest and IV/25; the request keys on those. Request byte-identical. |
| `simbad_sptype` → `build:binaries` → `multiples.tsv` → `build:membership` → manifest → `simbad_sptype` | Broken. Binaries reads only the WDS leg, which the manifest never moves; that leg becomes its own pull and file. |
| manifest ↔ `simbad_sptype` (the derivation's fourth binding source) | Kept. The request genuinely depends on the binding outcome. The stale-pull stop is its convergence check; re-pulling reopens the review queue, as `refresh/README.md` says. The same file also reaches the astrometry request (its derivation candidates), so manifest → `simbad_sptype` → request → astrometry pull → `build:membership` is a second path through this loop, covered by the same stop. |
| `build:binaries` ↔ its own astrometry request | Kept, same check. The request keeps rejected candidates, so it grows rather than oscillates. |
| `build:catalog` → `sid:allocate` → ledger → `build:catalog` | The `allocate` step kind. |
| `build:naming-parity` reads its own `naming-parity.tsv` | Carries frozen columns forward deliberately; not a pipeline step. |

## Derived checks

Hand-kept lists become derivations over the table:

- `tests/artifact-freshness.test.ts` iterates every stamp in `build/stamps/`
  and `data/stamps/`.
- `.worktreeinclude` may list only the `build` steps' stamped outputs, their
  stamp files and `build/lineage/`; a test checks it against the table.
- `tests/bundle-content.test.ts` reads the mirror steps' declarations.
- `cloud-surfaces.bin` records the hash of the `clouds.json` geometry it
  traced, and a test compares it with the current file.
- `resolved-hole-table.ts`'s record count is tested against
  `build-catalog-expected.json`'s `recordCount`.

## Migration

- **Bootstrap.** One commit writes `data/stamps/<step>.json` for every pull
  and baker from today's request files, data inputs and the query text in
  today's code, adopting today's committed outputs as fresh. The zero-pinned
  shortfall counts vouch for Bailer-Jones (`bjEligibleNotPulled`) and the
  astrometry catalogue's gate candidates (`gateSkippedNoGMag`,
  `derivedWeighedNoGMag`); Apsis and GSPC carry residual pins, which cannot
  show a stale request, and the SIMBAD, Tycho-2, binaries-astrometry and DR2
  neighbourhood pulls carry none, so those are adopted unverified. A baker's first
  record takes its inputs from today's hand list; its next run replaces them
  with the recorded set.
- **Order.** Runner core, then the stamped steps and the four generators, then
  the mtime steps and mirrors (after clouds and local-group set SIDs in their
  own records, so no step rewrites another's output, and after clouds' port
  to TypeScript, so it reaches the runner as a TypeScript step), then CI's
  `--verify-committed`, then the derived checks. The four loop breaks ship
  with the slice that moves their step.

## Design pass

- **Q1, one owner per fact.** Step order: the data flow. Outputs: each step's
  declaration. Code inputs: the import closure (TS) or the run record
  (Python). Data inputs: the source constants (TS) or the run record (Python).
  Freshness: the stamp. Force and snapshot updating: two runner flags.
  Committed-output verification: one runner mode.
- **Q2, wrong states.** Fresh, stale, failed and skipped-behind-a-stale-or-
  failed-step are the variants of one verdict union the runner matches on
  exhaustively; a missing stamp reads as stale, never fresh.
  `allocate`'s verdict is a value the runner matches on, not an exit code.
- **Q3, when it is true.** A stamp is written only after the step's checks
  pass and its outputs land (`emitArtifacts`); the lock is taken before the
  stamp is read.
- **Q6, the force.** One table absorbs 3 stamped steps, 2 emitters, 6
  mirrors, 3 CI-only generators and 1 that runs nowhere, about 20 pulls, 6
  bakers and the allocator.
  Step kinds exist because two runner behaviours (run it; check it and stop)
  each hold several cases today.
- **Q7, copies.** The two stamp helpers stay one per language with one JSON
  shape; `refresh_lib.is_up_to_date`, the mtime gates, `CATALOG_STAGE` and
  the inline YAML diff are deleted, not wrapped.
