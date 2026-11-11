# Record lineage — the per-record chain of custody

Every pipeline stage's decision about every record, kept as a row with its
reason code and the source rows it rests on, so any star traces from the
shipped record back to the catalogue rows it came from and every change
between two builds is explained. This README is the design contract the
folder's code is built to.

A stage returns a typed outcome per record; lineage is those outcomes
serialised. The target is that a stage's count snapshot folds from its
lineage lines, keyed on its reason codes ([Counts fold from lineage](#counts-fold-from-lineage)),
so the snapshot is a projection of lineage, never kept in step with it. Membership is part-way there:
its review-queue and label-drop counts fold from the outcomes, while the
derivation, admission and component counters are still kept by hand beside
them (stellata-hhaw.45.23). Promotion's per-row counters all fold from its
outcomes; its post-passes act on records and keep their own. Coherence's
snapshot keys are its codes, folded from its lines. Naming's display
counters fold from its outcomes the same way, under their `naming*` keys
(stellata-hhaw.45.23). The record walk's placement and brightness-colour
counts fold from each row's outcome (`../parse/walk-stats-pure.ts`), still
under their old keys (stellata-hhaw.45.23).

## Files in this area

```
scripts/catalog/lineage/
  lineage-row-pure.ts            The envelope and LineageLine, its TSV line:
                                 stageRow, the one row builder, which fills
                                 a row's stage and role from its codes;
                                 stageLineageLine, the one encoder, which
                                 refuses a code the stage does not declare
                                 or a row in another role than its code's;
                                 sortUtf8, the one order the stage lines,
                                 identity and SID files, reason-code list
                                 and trace keys sort by; and
                                 stageLineageText, the writer, which refuses
                                 another stage's line or lines out of order.
  reason-codes/                  stageCodes, the generated code list and its
                                 codec, `pnpm run lineage:codes`. Own README.
  lineage-diff-pure.ts           diffLineage, the merge-join of two stage
                                 files' lines; stageDiffText, the diff file.
  baseline/                      StageHeader, planBaseline and judgeBaseline:
                                 which baseline a build diffs against. Own
                                 README.
  identity-pure.ts               The identity row and its file; refuses two
                                 records on one key.
  lineage-stages.ts              LINEAGE_STAGES, every stage's codes and
                                 files in pipeline order: the one list the
                                 code generator and trace/ read, and the
                                 owner of the stage order the sections
                                 below name.
  trace/                         `pnpm run trace`. Own README.
  stage-lineage.ts               stageLineage: one stage's files, header,
                                 baseline plan, diff, budget and invariant
                                 checks, ready for the stage's emitArtifacts
                                 call; countedStageLineage, the same plus
                                 its count block.
  phase-clock-pure.ts            phaseClock: the budget line's per-phase
    (+ test)                     split of the timed window.
  lineage-invariant-pure.ts      LineageInvariant and its check (#invariants).
    (+ test)
  lineage-layout-pure.ts         LINEAGE_LAYOUT, the lineage folders,
                                 absolute. Their names, the stage specs and
                                 their output declarations:
                                 /src/catalog-format/pipeline-outputs/.
  line-spill.ts (+ test)         LineSpill: a stage's lines in a temporary
                                 file while another's are held (#storage-and-cost).
  lineage-io.ts                  The baseline members and a stage's emission,
                                 gzip, and the header with its input map
                                 and file hashes, re-checked on read.
  lineage-core-pure.test.ts      Order, writer refusal, diff.
  lineage-rotation.test.ts       Rotation over a scratch build/: a failed or
                                 absent emission moves nothing, another
                                 stage's files are never touched.
  spine-origin-key.test.ts       The spine origin key is the physical line
                                 and unique; the spine guard keeps it stable.
```

## Identity — the origin source row

Every row is keyed on the record's **origin**: a `SourceRowRef` naming the
source row that founded the record.

| Record founded by | Origin key |
|---|---|
| a spine row | its line number in the frozen `data/athyg/inherited-spine.tsv` |
| an addition group | the group anchor's source row — its IV/25 star, else its I/239 HIP, else its CNS5 row; the other members are evidence |
| a magnitude-term row | its Gaia DR3 `source_id` |
| a promoted companion | its `multiples.tsv` `(system_id, comp)` |
| a cloud or Local Group object | its record in `clouds.json` / `local-group.json`, by slug (`clouds:<slug>`, `local-group:<slug>`) |
| (no record) a same-class SID merge whose key only a stored same-as edge carries | that edge: `sameas:` followed by its two designations ([SID events](/scripts/sid/README.md#sid-events)) |

The spine's line number is stable because the file is frozen and
byte-guarded, and it covers Sol, whose identifier cells are empty; its
identifier cells are not the key, since a curated correction can rewrite
`tyc`. `spine-origin-key.test.ts` pins the key to the physical line and unique;
it is identical across builds because the spine guard pins the file's bytes.

Retiring the spine re-founds each spine record on a first-order catalogue
row, so its origin key changes while the star does not. That PR writes a
one-time map from spine line to new origin key — every line maps to
exactly one new key or a ledgered drop, checked by a test — and the diff
applies it across that transition, so those records diff as a changed
source rather than a deletion and an addition, and no SID event follows.

Record index and SID are attributes, never keys. One **identity row** per
record (`build/lineage/identity.tsv.gz`, `identity-pure.ts`) carries the
origin key, the manifest's current five-cell tuple
(`tyc`/`hip`/`hd`/`gl`/`gaia_source_id`, with the bound Gaia id) and the
full designation set, all written by membership. Each column lands with the
stage that computes it, never as a placeholder: the record index (after the
apparent-V sort) arrives when the sort stage gains lineage, the SID with
allocation's. A later stage writes its columns to a file of its
own (`allocation.sids.tsv.gz`: key → SID), rotated with that stage and
never by rewriting membership's; the identity row is the join of those files
on the origin key. A record membership does not admit — a folded spine row, a
component group — still gets one, keyed on the cells it arrived with, so
trace finds it. The ledger views and trace take their key columns from
this row, never re-deriving them — except where the deciding stage's input
cells ARE the ledger's key: `binding-review.tsv` keys on the spine cells
the derivation weighed, which its curated dispositions join on, so those
ride the binding row's `params`. A parked or dropped record never gets an
index or a SID: it has no `allocation.sids` row, and a SID it once held
is carried by allocation's parked, retired or merged row under the deciding
origin, with that decision's code as `cause`.

The manifest's five-cell tuple (`tyc`/`hip`/`hd`/`gl`/`gaia_source_id`) is
not the key: it changes exactly when a binding or label decision changes, so
a re-bind would diff as one record deleted and another added. The SID is not
the key either: mints and merges are what the diff exists to show.

A new Gaia data release changes magnitude-term origin keys. That is a real
identity change and travels as SID merge and retire events ([SID events](#sid-events)), not as
re-keyed lineage.

## Row contract

Every stage writes the same envelope:

| Column | Holds |
|---|---|
| `stage` | the stage that decided |
| `key` | the origin `SourceRowRef` |
| `role` | `outcome`, or `refused` for an alternative the stage weighed and rejected; declared once per code and filled from it by `stageRow`, never stated by a stage |
| `code` | a reason code from the generated list |
| `params` | per-instance detail (source id, component letter, sibling) |
| `evidence` | `SourceRowRef`s cited, each once and never the origin row (`evidenceTexts`) |

- Each stage declares its own payload columns next to its reason codes and
  serialises its outcome union through one function, so a variant with no
  row mapping fails typecheck.
- A refused alternative is a row of its own, never a nested list, so a
  choice diffs line by line.
- A stage writes a row for every record. A stage that can leave a record
  untouched gives it a `<stage>.not-applicable` code, a variant of its
  outcome union; a stage that decides every record it sees — membership admits,
  folds or ledgers each one — has no such variant, since a code nothing
  emits is a placeholder. A missing row then always means the record left
  that stage, never a silent pass-through; identical-code rows cost almost
  nothing compressed.
- SID, record index and designations live on the identity row only; the
  build version — the release the build stood on as it ran (`releaseAt()`),
  which for a releasing commit can be the release before it or its own,
  depending on whether its tag was pushed yet — lives in a per-build header
  file. Repeating them on every
  stage row roughly doubles each stage file.

### SourceRowRef

`{ source, row }`: `source` is the source's declaration constant (a
`defineSource` or `defineArtifact` constant,
`../../util/sources/README.md#sourcerowref`) and `row` is that source's typed
row key — never a path string. A source's licence is credited once, on the
site's credits surface; whether a public lineage surface must also filter its
citations by licence is the release design's question, and the filter would
be a join on `source`.

Its text form is `<source>:<row>`. Every lineage file sorts by the byte
order of that text form, then `role`, `code`, `params`, `evidence`. A stage
hands its rows over as lines (`LineageLine`, made only by `stageLineageLine`
or read from a stage file), and a tab sorts below every character a cell may
hold — `encodeLineageLine` refuses the control characters below it — so
sorting a stage's lines by their UTF-8 bytes (`sortLineageLines`) is that
order, and the writer and the diff check the same one — never a numeric
sort, so Gaia ids above 2^53 order the same everywhere. A key's rows diff as a set:
changed means the set of rows under one key differs. `params` is empty or a
JSON object whose keys keep the stage's declared order, so one payload has
one text; `evidence` is its references' text forms joined by `|`.

## Reason codes

Every row's `code` is on one closed, append-only list generated from the
stages' declarations: [reason-codes/](reason-codes/README.md).

## Invariants

A tripwire is an invariant over a stage's own lines, never a pinned count: a
count says a number moved, a query names the rows that moved it. Each
`LineageInvariant` (`lineage-invariant-pure.ts`) names one code that must not
appear, what holds while it does not, and its allowed exceptions as a
predicate over the row's `params` (`NO_EXCEPTIONS` for a zero-pin). A stage
declares its invariants beside its codes and hands them to `stageLineage`,
which checks every line before emission: a violation is a failed check, so
nothing lands, and the message lists the offending rows' keys and params.
Placement's (`PLACEMENT_INVARIANTS`): no `distance.bailer-jones-absent` row.
Naming's (`NAMING_INVARIANTS`): no `dc.none` row.
Membership's (`MEMBERSHIP_INVARIANTS`): no `admit.magnitude` row whose
`own_candidate` is outside `ALLOWED_OWN_CANDIDATE_REASONS`
([The additions](../membership/additions/README.md#grouping-and-admission)), and no
`binding.unweighed-no-pulled-row` row
([The candidates have to be in the astrometry pull](../membership/binding/README.md#the-candidates-have-to-be-in-the-astrometry-pull)).

## Counts fold from lineage

A stage's count-snapshot keys are its reason codes, so the code list is the
one owner of every counted tier. `foldStageLines(codes, lines)`
(`lineage-row-pure.ts`, over `../../util/counts/tally-pure.ts`'s `fold`) counts a
stage's lines per live code, every live code present, typed
`Record<code, number>` from the stage's `live` codes — a retired or
historical code is no key, and a line carrying one throws; each code is declared in
one role, so a stage's outcomes and refusals fold into one record and no
code is counted in both. A line of another stage, or in a role its code is
not declared in, throws. `countedStageLineage` (`stage-lineage.ts`) is
`stageLineage` plus that fold over the same lines, inside the timed window:
its `counts` is the stage's count block, which the build composes into its
snapshot ([The staged snapshot](../../util/counts/README.md#the-staged-snapshot)). A stage with no codes yet keeps its snapshot keys until it gains
lineage.

## SID events

SID allocation is a stage run inside `build:catalog`, after promotion; each sibling
build allocates as a stage of its own, `allocation-clouds` in `build:clouds`
and `allocation-local-group` in `build:local-group`. Their rows, events and
fail-closed rule live beside their modules, in [SID events](/scripts/sid/README.md#sid-events).

## Storage and cost

`build/lineage/<stage>.tsv.gz`: gzip level 1, sorted by key, every record at
every stage, no reduced-detail mode.

A design-time probe on 1M synthetic rows (2026-10-21) chose the format: the
bulk is Gaia ids, which no format compresses much, and Parquet with zstd
came out about 15% smaller at five to nine times the write cost and the
loss of `zgrep`. Its per-stage size is not a sizing figure: plan a new
stage from the measured budgets below, and every build prints its own
(`<stage> lineage: N bytes gzipped`). With `build/lineage.previous/` a
checkout holds about twice the current build, and each new worktree copies
one build's worth in.

The real stages' write time and disk are pinned as a budget: each stage
passes `stageLineage` (`stage-lineage.ts`) a `LineageBudget`, and a run over
it fails its emission. Membership, measured 2026-10-29 on the full tree:
1,355,182 rows (128 MB plain, 15.1 MB gzipped) plus 976,040 identity rows
(85 MB, 22.3 MB), 37.4 MB together. The timed window is everything lineage
adds to the build — the baseline headers' file re-hash, the base's input
re-hash each verdict asks for, producing the lines (`lines`, a function the
window calls: a spill reads back there), the diff, rendering,
gzip and invariants: about 5.8 s with a diff
against a full baseline. The merge-base input re-hash measured 128 ms for
membership on a branch where 9 of its 163 inputs differ (2026-11-04,
`inputHashesAt` over `inputHashes(stepInputPaths('build:membership'))`); a
changed 204 MB LFS input adds its own hash of the local object. The header's input map is not in it: a stage hands
`stageLineage` the input hashes the runner took for its step's stamp before
starting it (`stepInputHashes`, `../../util/step-input-hashes.ts`), so no
step hashes its own input set. `build:catalog` does hash membership's inputs
from disk, once per build (`upstreamLineage`), to judge membership's header
against the base: 153 paths in 275–352 ms (2026-11-05,
`onDiskHashes(stepInputPaths('build:membership'), {})`), inside the first
catalogue stage's timed window.
A spine derivation's row carries only its winner, route and component
letters; the binding-review columns ride the rows the queue lists — a
contested or collision verdict and a disposition — since the candidates and
refusals are rows of their own. `MEMBERSHIP_LINEAGE_BUDGET` pins 41 MB and
20 s: a CI run that diffs against a restored merge-base baseline took
11.2 s (2026-11-06), against 6.8 s with no diff. Promotion, measured 2026-11-01: <!-- count:build-binaries/multiples_rows_emitted -->47,021<!-- /count --> rows, one
per `multiples.tsv` row, plus 31,908 identity rows (<!-- count:build-catalog/companionPromoted -->14,676<!-- /count --> minted companions,
17,232 rows it retires, parks or merges), 0.95 MB gzipped in 0.2 s;
`PROMOTION_LINEAGE_BUDGET` pins 1.04 MB and 10 s: a CI run with a diff took
6.9 s (2026-11-07), almost all of it the baseline phase. Every other stage's
measured budget sits beside its contract: [allocation's](/scripts/sid/README.md#sid-events),
[placement's](../distance/README.md#placement-lineage),
[brightness-colour's](../photometry/README.md#brightness-colour-lineage),
[size's](../spectral/README.md#size-lineage),
[coherence's](../multiplicity/README.md#coherence-lineage) and
[naming's](../naming/README.md#naming-lineage). Placement's 349 MB plain outruns
V8's longest string, so stage files and diffs are written and read as UTF-8
bytes in chunks, and the diff walks the baseline a key at a time
(`streamLineage`) rather than holding it.

A stage that size cannot hold its rows as objects either: 3.9 million
`LineageRow`s, beside the `Placement`s they came from, are about 1.7 GB of
heap. So a stage hands `stageLineage` lines, never rows, and placement,
brightness-colour and size serialise each record to their lines inside the
walk, keeping only the strings; the diff reads the baseline as lines too,
and only a reader that needs fields (trace, a ledger view) decodes them.
Even as strings the three stages' 8.8 million lines (placement 3.9M,
brightness-colour 4.0M, size 0.96M) overrun the heap budget together, so
brightness-colour's and size's go to a `LineSpill` each during the walk and
are read back one stage at a time, once placement's lines are released.

The committed form of lineage is `data/sid/events.tsv` plus the ledger views
below; the derivation itself is a build artifact, regenerated every build.

## Run-to-run diff

The baseline is kept per stage in `build/lineage.previous/`, and what a
branch's report needs is the whole change against main, so a **clean build
at the merge-base is pinned there**: while `lineage.previous/` holds one,
every later build diffs against it and leaves it in place (`planBaseline`).
Otherwise, and always on main, the stage's current `<stage>.tsv.gz` replaces
`build/lineage.previous/<stage>.tsv.gz` in the same emitArtifacts commit
that renames the stage's new file into place, and the build diffs against
that last build if its input map is the merge-base's — or, on main, its own
commit's, a commit in HEAD's history ([Choosing the baseline](baseline/README.md)). A stage that fails, is skipped by
its content-hash stamp, or does not run (a standalone `build:membership`)
leaves both its copies untouched. The baseline and diff families are
declared unstamped (`stageFamilies`), so a step's stamp never records them
and a worktree without them is not stale.

Which baseline a build may diff against — the per-stage header, what it
records and when the diff refuses — is [Choosing the baseline](baseline/README.md).
A stage diff is a merge-join of two files sorted by that
one comparator: keys added, removed and changed.

Every stage diff writes `build/lineage-diff/<stage>.tsv` — outside
`build/lineage/`, so a worktree's seed never carries another checkout's
diff; the membership change report is the first. One line per row that
differs within a changed key: `change` (added / removed / changed), `side`
(`-` baseline, `+` current), the six envelope columns, then any column the
stage joins on from another stage's facts. A PR whose build leaves a
non-empty diff puts that diff's summary in its PR body.

## Trace

`pnpm run trace`, every stage's rows for the records a query names, lives in
[trace/](trace/README.md).

## Cross-stage joins

Every join is on the origin key, never a re-derivation. The binaries
`Binding` provenance type must carry a component's `(system_id, comp)` and
its HIP, which is what the membership change report joins a re-bound row
onto; until that type lands, the join reads `multiples.tsv`'s existing
columns, through the record's HIP on the identity row — the current build's, or
the baseline's for a key the build removed.

## Committed ledgers become views

The per-record ledgers the stages commit today are serialisations of stage
verdicts. Each becomes a view generated from lineage, still committed, and
still regenerated and diffed by CI, so a PR diff keeps showing the change:

| Ledger | Generated from |
|---|---|
| `data/membership/additions-ledger.tsv` | membership admission rows |
| `data/membership/label-drops.tsv` | membership label-drop rows |
| `data/membership/binding-review.tsv` | membership binding-verdict rows |
| `data/classic-ids/label_flips.tsv` | membership label-merge rows |
| `data/classic-ids/rejected_bindings.tsv` | classic-id binding-verdict `refused` rows |
| `data/classic-ids/hd_hip_route_disagreements.tsv` | classic-id route rows |
| `data/membership/parked-ledger.tsv` | placement park rows |

`binding-review.tsv` and `rejected_bindings.tsv` are then two filters over
one row type. Each view moves when its writing stage gains lineage; the
first four are views now ([Membership lineage](../membership/README.md#membership-lineage)),
and so is `parked-ledger.tsv` ([Placement lineage](../distance/README.md#placement-lineage)).

## The membership stage

`build:membership` is the first stage with lineage; its contract lives
beside its module, in [Membership lineage](../membership/README.md#membership-lineage).

Curated human input stays hand-written and is read by the build or its
tests: `binding-review-dispositions.tsv`, `spine-corrections.tsv`,
`hd_hip_route_disagreements_review.tsv`, `classic_id_overrides.tsv`,
`sameas-overrides.tsv`. `data/sid/ledger.tsv` keeps its own contract.
`data/sid/events.tsv` holds every row of the two retirement files it
replaced, each under a `historical` code (`allocation.legacy.*`, declared in
`../../sid/allocation-lineage-pure.ts`), one per distinct legacy cause, its
row-specific text in `params.reason` where it is not the code's own
description. Retired state is decided by counting retire and merge events
against reinstates per SID, as it was over the two files.

## The placement stage

`build:catalog`'s record walk is the stage after membership; its contract lives beside
its module, in [Placement lineage](../distance/README.md#placement-lineage).

## The brightness-colour stage

`build:catalog`'s V, spectral class, B−V and de-extinction are the stage
after placement, written from the same record walk as placement; its contract lives
beside its module, in [Brightness-colour lineage](../photometry/README.md#brightness-colour-lineage).

## The size stage

`build:catalog`'s physical radius is the stage after brightness-colour,
written from the same record walk; its contract lives beside its module, in
[Size lineage](../spectral/README.md#size-lineage).

## The coherence stage

`build:catalog`'s system distance coherence is the stage after size; its contract
lives beside its module, in [Coherence lineage](../multiplicity/README.md#coherence-lineage).

## The naming stage

`build:catalog`'s display-name pass is the last stage, after allocation; its
contract lives beside its module, in [Naming lineage](../naming/README.md#naming-lineage).

## The promotion stage

`build:catalog`'s companion promotion is the stage after coherence
(`../companions/promotion-lineage-pure.ts`). `promoteCompanions` returns one
`PromotedRow` per `multiples.tsv` row, keyed on that row
(`multiples:<system_id>/<comp>`), and `promotionLineageRow` serialises its
`RowOutcome` (`../companions/README.md`) through an exhaustive `switch`. A
pair's primary that anchors its pair is `promotion.not-applicable.pair-anchor`.
A row in no pair is `promotion.parked.unpaired`, and a primary that resolves
to no record, leaving its pair anchor-less, `promotion.parked.primary-unresolved`:
both park, since promotion ships no record for the star the row names, so a
SID keyed on its identifiers stays in the ledger with that cause. Each row cites as evidence the record its pair
resolved to and its WDS root's anchor; every merge-effect row names the
record it merges into in `params.record`. Both are origin keys: every record
carries its own from the manifest's `origin_key` column
(`../membership/README.md#columns`), so these are joins on the origin key.

A minted companion is founded on its row, so promotion writes its identity
row (`promotion.identity.tsv.gz`, named by `StageLineageSpec.identity`). So
does every row whose code retires, parks or merges, keyed on the `hip` and
`gaia_source_id` cells it arrived with and the synthetic key a mint from it
would carry (`PromotedRow.synthKey`), less any designation a membership
manifest record or one of promotion's own mints already carries, so an
orphaned SID keyed on one of them joins to that row's cause and never to a
row that merely cites another stage's star. A cloud's or Local Group
object's is its sibling allocation stage's; every other record's is
membership's.
