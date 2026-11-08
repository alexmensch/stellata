# SID registry tools

Build-time tooling for the Stellata ID registry: allocation into the
frozen ledgers under `data/sid/` ([Registry partitions](#registry-partitions)), the Gaia DR-transition risk-set export,
and the DR reconciliation classifier. The full design — identity
model, canonical-key ladder, allocation, CI guard, DR procedure — is
`docs/sid.md`; the committed registry files are rostered in
`data/sid/README.md`. This README carries the tool contracts.

```
sid-pure.ts               Pure algebra: designation grammar (/docs/sid.md#3-designation-namespaces),
                          canonical-key ladder (/docs/sid.md#42-canonical-key--stability-first), same-as classes
                          (sameAsClasses, the one class build: allocation
                          and the membership parity matcher both call
                          it, /docs/sid.md#41-same-as-equivalence-graph), per-record designation
                          extraction (starDesignations),
                          parsers for every registry file, each taking
                          the declared file it reads (readTable in
                          exact mode, which also owns the LF / final-
                          newline / no-blank-line layout the head hash
                          relies on; a RegistryFile keeps each row's
                          rawLine from the same walk for the hash), head snapshot + append-only checks (/docs/sid.md#43-ledger--datasidledgertsv, /docs/sid.md#45-ci-guard).
                          Imports no declaration, so its many importers
                          reach no registry file through it. Tests import
                          its constants — never redefine them.
ledger-pure.ts            A registry ledger's row shape, SID_KINDS and cell
                          encoding, apart from its declarations.
ledger-tsv.ts (+ test)    LEDGERS — each partition's ledger codec, plus
                          ledgerFile. Every
                          registry file reads a sid as TableRow.id
                          (../util/tsv/README.md). The test round-trips
                          every committed ledger byte for byte.
events-pure.ts (+ test)   An events file's row shape, validateEvents, and the
                          retired-state count (retiredSids,
                          sidSuccessorPairs): out of service iff more
                          retire + merge events than reinstates.
events-tsv.ts (+ test)    EVENTS — each partition's events codec, plus
                          eventsFile; the test round-trips every committed
                          file.
allocate-pure.ts (+ test) allocate: every object resolved, minted or
                          reinstated, and every SID no object keeps
                          settled by the upstream decision that removed
                          it (/docs/sid.md#44-allocation). Asks the
                          lineage through Upstream's two batched lookups,
                          for orphans and merge-losing class-mates only
                          (every build asks about the parked SIDs) and
                          for new or reappearing objects. A park
                          outranks a retire; an orphan no decision
                          explains, a merge mixed with another removal
                          and a new object no stage admits each fail
                          closed. A failed allocation is its own variant.
allocation-lineage-pure.ts  Allocation as a lineage stage: its reason
  (+ test)                codes (live, plus the historical legacy.*
                          codes the migrated retirement rows carry), the
                          one serialiser over its outcomes, and
                          allocation.sids (key -> SID), its own codec.
                          objectOutcomeCodes / objectOutcomeRows: the
                          resolved / minted / reinstated codes and rows
                          under any stage name, which the sibling stages
                          declare as theirs.
lineage-upstream-pure.ts  lineageCauses: each ledger key joined, through
  (+ test)                every identity row carrying it, to the retire /
                          park / merge outcomes recorded under those
                          origin keys, with the stages that hold such a
                          row; lineageAdmissions: each origin's admitting
                          code ([SID events](#sid-events)).
synth-churn-pure.ts       synthChurnReport: for each synth key that left
  (+ test)                the build with no decision (Allocation's
                          failed.unexplained), every live synth key under
                          the same WDS root with its multiples.tsv comp,
                          separation and position angle; build:catalog
                          prints it with the failure.
catalog-upstream.ts       catalogUpstream: build:catalog's Upstream, over
                          membership's lineage files from the last
                          build:membership and placement's and
                          promotion's from this build.
catalog-objects.ts        catalogSidObjects: build:catalog's objects in
                          allocation order (its records, then the sol and
                          shell lists).
sameas-source.ts          SAMEAS_OVERRIDES and SAMEAS_BRIDGES: the curated
                          edges, and data/sid/bridges/ as a folder source
                          whose *.tsv files are its members, so a new
                          bridge changes a reader's input set.
object-mints-source.ts    SOL_OBJECTS, SHELL_OBJECTS — the sol: / shell:
                          mint lists, declared and keyed on their rows'
                          key cell, which is each object's origin.
stored-edges.ts           loadStoredEdges: overrides plus bridges, the
                          stored half of the same-as graph. Its own module,
                          so a reader of edges alone reaches no other
                          registry file.
catalog-designations.ts   Designation set per BUILT catalog record, from
                          catalog.bin + the two public/ sidecars (README.md#designation-extraction--where-each-namespace-comes-from). Shared by trace and
                          the inherited spine's parity gate.
registry-partitions-pure.ts  partitionOf / inPartition (a namespace's
                          owner, and the scope its allocation runs
                          under) and registryHint. The partitions
                          themselves (REGISTRY_PARTITIONS,
                          RegistryPartition) and each one's file names
                          and emit keys are
                          /src/catalog-format/pipeline-outputs/data-files.ts's,
                          so an outputs module can declare them at
                          table load.
registry-pure.ts (+ test) unionLedger / unionLedgerLines: every
                          partition as one sid sequence; validateRegistry:
                          that union dense and unique, each ledger
                          ascending and keyed only in its own namespaces,
                          each events file naming only its own sids,
                          a merge's successor included;
                          registryAppendOnly: the guard's frozen-prefix
                          verdict over the merge-base heads, both
                          regimes (pre-split union, per partition).
registry-io.ts            loadRegistry: every partition plus the stored
                          edges, validated (every event code in the
                          generated list), the ledgers and the events
                          each as their union.
                          Every file is required; a suite that may meet
                          an LFS-stub ledger gates on
                          isReadable(LEDGERS.catalog) itself.
                          readRegistryUnion: the same rows unvalidated,
                          for lookup-only readers (trace).
                          registryTexts(partition, …): that partition's
                          ledger and events with an allocation's rows
                          appended as encodeLine lines, never a committed
                          line rewritten, and its head recomputed. Shared
                          by build-catalog and allocateSibling.
registry-step-inputs.test.ts
                          Every allocating step (build:catalog,
                          build:local-group, build:clouds) has every
                          partition's ledger and events in its
                          stepInputPaths, read through the LEDGERS /
                          EVENTS declaration maps
                          (../util/sources/README.md#reached-means-read).
export-dr-risk-set.ts     pnpm run sid:risk-set — source_ids of the
                          non-retired gaia_*-keyed ledger rows, written
                          as the next DR transition's neighbourhood-pull
                          request TSV (/docs/sid.md#61-procedure step 1),
                          through emitArtifacts to
                          build/sid/dr-risk-set-request.tsv
                          (dr-risk-set-outputs.ts; gitignored). Run by
                          hand at a DR transition, never by the build:
                          no step reads its output. Never the
                          committed DR2 request: that one is frozen as
                          half of the dry-run pair
                          (dr2-neighbourhood-source.ts), and
                          tests/step-outputs.test.ts fails if any step's
                          declared outputs cover either file.
dr-reconcile.ts           pnpm run sid:dr-reconcile — churn report for a
                          DR transition (/docs/sid.md#61-procedure classes),
                          plus the carried-1:1 same-as edges for human
                          review in build/sid/dr-reconcile-bridges.tsv
                          (dr-reconcile-outputs.ts; gitignored, a draft
                          reviewed and committed as
                          data/sid/bridges/<from>_<to>.tsv, never
                          committed itself). Defaults replay the committed DR2→DR3
                          dry-run inputs (/docs/sid.md#62-dr2dr3-dry-run-measured-2026-07-07):
                          dr2-neighbourhood-source.ts declares that pair.
                          --request= (a fresh sid:risk-set export) /
                          --neighbourhood= declare another transition's
                          files through the same module's
                          sourceIdRequestSource / neighbourhoodSource, so
                          each file kind has one parse.
dr-reconcile-pure.ts      Pure classifier + request/neighbourhood TSV
                          readers. ACCEPT_MAS / MAG_REVIEW_DELTA live
                          here.
sibling-allocation.ts     allocateSibling: one sibling namespace allocated
  (+ test)                over the registry, giving each record's sid, its
                          lineage lines and identity rows, and the
                          partition's files only when the allocation
                          appended, so a run that mints nothing rewrites
                          no registry file (null otherwise, never a
                          partial set); siblingLineage, its stage's
                          emission; emitSibling, the artifact, that
                          emission and those files in one emitArtifacts
                          call. Called by build:local-group and
                          build:clouds.
sibling-artifacts-pure.ts SIBLING_ARTIFACTS spec (ns / kind /
                          mint code / rowId / lineage stage and its
                          codes per sibling) + siblingArtifactObjects,
                          each object founded on its record of the
                          artifact the caller hands in, so the
                          namespace→kind mapping is defined once. Each
                          JSON declaration takes its row-key id from
                          rowId, and allocateSibling's types refuse an
                          artifact whose id is another sibling's. Each namespace is its
                          own registry partition: ns is typed by
                          SIBLING_PARTITIONS, and
                          EVERY_SIBLING_PARTITION_CLAIMED fails typecheck
                          while a partition has no artifact. siblingSlug
  (+ test)                is the one slug rule both builds key each
                          record's id (and so its SID) on.
```

The append-only CI guard is `tests/sid-ledger-guard.test.ts` (repo-meta:
it guards committed data, not this folder's code). It self-skips where
`ledger.tsv` is an LFS pointer stub — the bare CI `test` job — and runs
for real in `build-catalog`, checked out with the full history its
merge-base check reads, and locally.

The LFS-stub predicates themselves (`isLfsPointer`, `isLfsPointerFile`,
and `lfsContentReadable`) live in `scripts/util/paths.ts`, not here — see
that folder's README for why; a suite gating on a declared file takes
`isReadable(declared)` (`scripts/util/sources/`).

## Registry partitions

The registry is split by allocating step, so each file has one writer:
`build:catalog` owns the `catalog` partition (`ledger.tsv`, `events.tsv`,
`ledger-head.json`: every namespace but the siblings'), `build:clouds` owns
`cloud` (`ledger-cloud.tsv`, `events-cloud.tsv`, `ledger-head-cloud.json`)
and `build:local-group` owns `lg` (the same three, suffixed `-lg`).
`registry-partitions-pure.ts` decides which namespace lands where.

SIDs remain one dense sequence across all of them: every allocation mints
past the highest SID in the **union** of the ledgers, so each allocating
step reads every partition's ledger and events and writes only its own.
`validateRegistry` holds the union dense and unique; the guard checks each
partition append-only against its own merge-base head, or the sid-ordered
union against the catalogue head when the base predates the partitions.
The read loop this makes among `build:catalog`, `build:clouds` and
`build:local-group` is a kept loop in the step graph
([Loops through committed files](../pipeline/README.md#loops-through-committed-files)).

## SID events

SID allocation is a lineage stage (`allocation-lineage-pure.ts`),
run in-process by `build:catalog` over the records, sol and shell objects,
by `build:local-group` over `lg:` and by `build:clouds` over `cloud:`. Per
object it records `allocation.resolved` (with `via`, the ledger key, only when
the object reached it through a designation it does not carry),
`allocation.minted` or `allocation.reinstated` (with the admitting code),
keyed on the object's origin; per SID no object keeps,
`allocation.retired`, `.parked` or `.merged`, keyed on the origin of the
upstream decision that settled it, with that code as `cause`. Its key -> SID
file `allocation.sids.tsv.gz` maps each origin key to its SID. Each sibling
build allocates as a stage of its own (`allocation-clouds`,
`allocation-local-group`), writing the object rows under its own codes, keyed
on the object's record in its artifact (`clouds:<slug>`,
`local-group:<slug>`), and an identity file carrying each object's one
designation, which trace finds it by. A sibling SID rides its artifact, so
these stages keep no key -> SID file.

An orphan inherits its cause from the upstream decisions on its record,
joined on the origin key (`lineageCauses`, `lineage-upstream-pure.ts`):
every identity row carrying the SID's canonical key, then every outcome row
under those origins whose code removes or re-binds.

Its rows follow the lineage row contract
([Row contract](/scripts/catalog/lineage/README.md#row-contract)): one per
object, under its origin key, and one per SID that left the
build under its deciding origin.

Allocation is the sole writer of each partition's events file, apart from the
one-time migration of the legacy retirement files
([Committed ledgers become views](/scripts/catalog/lineage/README.md#committed-ledgers-become-views)) — `sid`, date, event
(`mint`|`retire`|`reinstate`|`merge`), code, params (`{"key": <origin>}`,
the decision's or the admitted record's), successor, build version —
append-only and guarded like the ledger. Events follow from the declared
effect of the upstream code:

| Cause | Event |
|---|---|
| a new object | `mint`, coded by the decision that admitted the record (`membership.admit.*`, `promotion.minted`, or allocation's own `allocation.mint.*` for the sol, shell, cloud and Local Group lists) |
| upstream effect `retire` | `retire` |
| upstream effect `merge` | `merge`, with the SID of the record the decision names (`params.record`, else its single evidence ref) |
| upstream effect `park` | none: the SID stays in the ledger, absent from this build ([§ 4.4](/docs/sid.md#44-allocation)) |
| park and retire together | none: a park outranks a retire, so the SID stays live while any stage only parks its record |
| a retired class reappears | `reinstate`, coded like a mint |

Fail closed, naming the stages that hold the record: an orphan with no
retire, park or merge decision; a merge mixed with any other removal, or
whose target carries no SID; a new or reappearing object no stage admits.
`tests/sid-ledger-guard.test.ts` checks every event row's code is in the
list and declares that effect.

Allocation, measured 2026-11-01: 980,151 rows (979,712 objects plus 439
parked SIDs, 62.6 MB plain) and 979,712 key → SID rows (29.1 MB), 17.6 MB
gzipped in 4.7 s without a diff; `ALLOCATION_LINEAGE_BUDGET` pins 19.3 MB and
28 s: a CI run with a diff, building the lines inside the window, took 18.6 s
(2026-11-08). The
sibling allocation stages, measured 2026-11-05: 96 cloud rows in 1,455 bytes
and 123 Local Group rows in 1,720 bytes gzipped, identity files included,
each in about 0.1 s; `SIBLING_LINEAGE_BUDGET` (`sibling-allocation.ts`) pins
1,900 bytes and 5 s for either.

## Designation extraction — where each namespace comes from

`catalogRecordDesignations` (`catalog-designations.ts`) owns the catalog
half of this over the built artifacts, so trace and
`scripts/catalog/membership/membership-manifest-gate.test.ts` cannot derive
different sets from them; build:catalog's allocation calls the same
`starDesignations` over its in-memory records.

Per catalog record: `hip:` + `gaia_dr3:` from the record fields,
`hd:`/`hr:`/`gl:` from its `search-index.json` entry — plus a second `hd:` or
`hr:` per `hda`/`hra` alias, since both numbers name the star
(`scripts/catalog/classic-ids/label-merge/README.md`) — `synth:` from
`catalog-row-index-map.json` `bySynth` (runtime `synth-` prefix
stripped), `sol:sun` from `FLAG_IS_SOL`. Clouds and Local Group carry
their artifact `id` slugs; planets, moons, and probes all come from
`data/sid/sol-objects.tsv`, which is scoped by system membership rather
than object class — the row's `kind` column carries the class (the
`sun` row is not a second object: it rides the Sol record, realising
the [§ 7](/docs/sid.md#7-storage--sid-in-every-artifact) same-as edge). Boundary shells come from
`data/sid/shell-objects.tsv` (same `key\tkind` format, `shell:` ns).
`gl:` keys have whitespace collapsed
to `_` (`gl:Gl_804`) to satisfy the [§ 3](/docs/sid.md#3-designation-namespaces) no-whitespace grammar.

## Ambiguous designations are dropped, not assigned

A designation carried by more than one record — **68 in the 2026-09-08
build: 57 `hd:`, 11 `hr:`**, always a component pair sharing one
catalogue number — names a
catalogue granularity, not one physical object. Assigning it to either
record would freeze an arbitrary claim into the append-only ledger;
unioning through it would fuse two distinct objects' identities. So it
is excluded from the same-as graph entirely — it can neither key a
ledger row nor merge classes. A stored edge (`sameas-overrides.tsv`,
`bridges/`) naming one would put it back, so `sameAsClasses` throws on it
and every allocation and resolution fails. Every affected record keys off its own
unique HIP/Gaia id; a record whose ONLY designation is ambiguous would
hard-fail allocation as keyless (zero such records today).

Re-derive the count rather than trusting this line — a catalogue build prints
one `ambiguous (dropped)` line per dropped designation, and the total moves
with membership.

## Ownership pin — synth churn resolves here

All synth-key reconciliation (WDS re-lettering, [§ 5](/docs/sid.md#5-synthetic-key-churn-wds-re-subdivision)) lives
in this folder's allocation; the binaries pipeline stays sid-free. A
ledger `synth:` key absent from the build is settled like any other
orphan: promotion's identity rows carry the synthetic key of every row it
removes or merges, so a companion promotion dropped retires (or parks, or
merges) under that row's code. A key whose row left `multiples.tsv`
altogether has no decision, so the build fails closed, printing the live
synth keys under the same WDS root with their geometry: a re-lettered
component needs a bridge line in `data/sid/sameas-overrides.tsv`, and a
component that genuinely dissolved needs a coded decision in the stage
that drops it. A vanished `cloud:`/`lg:` slug fails its build the same
way — a slug RENAME needs a bridge.

A Stage-5 filter change that mass-drops optical pairs orphans every
synth key those pairs minted, and each retires under promotion's code
for its row. (The reverse — a pipeline refinement re-promotes a
component whose sid was retired — is a `reinstate` event carrying the
admitting code, [§ 4.3](/docs/sid.md#43-ledger--datasidledgertsv).) Allocation writes those events in the same build,
so the PR's `data/sid/events.tsv` diff is the review surface: CI's
catalogue stage fails on any event the PR did not commit, so main stays
consistent and every event on an up-to-date branch is the current
change's.

## Sibling-artifact stamping

`clouds.json` and `local-group.json` carry an in-record `sid` ([§ 7](/docs/sid.md#7-storage--sid-in-every-artifact)),
each allocated over its own namespace by `allocateSibling`
(`sibling-allocation.ts`), in-process in the step that builds the artifact:
`build:local-group` allocates `lg:<id>` and `build:clouds` allocates
`cloud:<id>`, each landing its artifact and its partition in one
`emitArtifacts` call, so every file has one writer and none is rewritten
after the fact. A new slug mints under
`allocation.mint.cloud` / `.local-group` and appends to its partition, and
the same `emitArtifacts` call lands the build's allocation stage. No stage
upstream of a sibling build decides anything about its objects, so a
vanished slug has no decision and fails its step (a renamed slug needs a
`sameas-overrides.tsv` bridge). The
catalog's stellar sids are allocated in-record at build time
([SID allocation](/scripts/catalog/README.md#sid-allocation)); the Sol
system's are pinned client-side in
`src/client/solar-system/sol-object-sids.ts`.
