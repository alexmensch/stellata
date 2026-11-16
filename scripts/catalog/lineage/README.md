# Record lineage — the per-record chain of custody

Every pipeline stage's decision about every record, kept as a row with its
reason code and the source rows it rests on, so any star traces from the
shipped record back to the catalogue rows it came from and every change
between two builds is explained. This README is the design contract the
folder's code is built to.

A stage returns a typed outcome per record; lineage is those outcomes
serialised. The target is that a stage's count snapshot folds from its
lineage lines, keyed on its reason codes ([Counts fold from lineage](#counts-fold-from-lineage)),
so the snapshot is a projection of lineage, never kept in step with it. Membership's
keys are its codes, beside a derived block
([Membership lineage](../membership/README.md#membership-lineage)). Coherence's,
brightness-colour's, promotion's and naming's snapshot keys are their codes,
folded from their lines (naming's beside a code-less authority tally,
[Naming lineage](../naming/README.md#naming-lineage); promotion's post-passes,
which act on records, file a derived block), and so are component-binding's, pairs', runtime-pairs', overlap's and classic-ids' (beside
a derived block of the overlay's sizes,
[Counts and the parity measurement](../classic-ids/README.md#counts-and-the-parity-measurement))
and placement's,
beside a derived block of the shipped tiers
([Placement counts](../distance/README.md#placement-counts)). Resolve's
snapshot keys fold from its lines without being its codes, each audit verdict
counted once ([Resolve lineage](/scripts/binaries/resolve/README.md#resolve-lineage)),
and so do astrometry's, both unresolved codes as one
([Astrometry lineage](/scripts/binaries/astrometry/README.md#astrometry-lineage)),
and orbits', from its source codes
([Orbits lineage](/scripts/binaries/orbits/README.md#orbits-lineage)).

## Files in this area

```
scripts/catalog/lineage/
  lineage-row-pure.ts            The envelope and LineageLine, its TSV line:
                                 stageRow, the one row builder, which fills
                                 a row's stage and role from its codes;
                                 stageLineageLine, the one encoder, which
                                 refuses a code the stage does not declare
                                 or a row in another role than its code's,
                                 and stageLines, it over a stage's rows;
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
  identity/                      The origin key and the identity row.
                                 Own README.
  lineage-stages.ts              LINEAGE_STAGES, every stage's codes and
                                 files in pipeline order: the one list the
                                 code generator and trace/ read, and the
                                 owner of the stage order the sections
                                 below name.
  trace/                         `pnpm run trace`. Own README.
  stage-lineage.ts               stageLineage: one stage's files, header,
                                 baseline plan, diff, budget and invariant
                                 checks, ready for the stage's emitArtifacts
                                 call; foldedStageLineage, the same plus a
                                 fold over its lines, and
                                 countedStageLineage, that fold as its
                                 count block; namedStageRun, the run of
                                 a stage whose lines file is named for it,
                                 which build:catalog and build:binaries
                                 build their stages with; mergedEmissions,
                                 several stages' emissions as one
                                 emitArtifacts part.
  stage-lineage-sources.ts       stageLineageSources: a stage's current
                                 lines and identity files as the sources a
                                 later step reads.
  phase-clock-pure.ts            phaseClock: the budget line's per-phase
    (+ test)                     split of the timed window.
  lineage-invariant-pure.ts      LineageInvariant and its check (#invariants).
    (+ test)
  lineage-layout-pure.ts         LINEAGE_LAYOUT, the lineage folders,
                                 absolute. Their names, the stage specs and
                                 their output declarations:
                                 /src/catalog-format/pipeline-outputs/.
  storage/                       The file format, each stage's budget, and
                                 LineSpill. Own README.
  lineage-io.ts                  The baseline members and a stage's emission,
                                 gzip, and the header with its input map
                                 and file hashes, re-checked on read.
  count-block-fixture.ts         Test-only: seededCodeCheck, a stage's count
                                 block against its snapshot before and after
                                 a code is seeded, so each counted stage pins
                                 that a new code reaches the snapshot.
  lineage-core-pure.test.ts      Order, writer refusal, diff.
  stage-merge.test.ts            stagesOutputFiles and mergedEmissions.
  lineage-rotation.test.ts       Rotation over a scratch build/: a failed or
                                 absent emission moves nothing, another
                                 stage's files are never touched.
```

## Identity — the origin source row

Every row is keyed on the record's origin, the source row that founded it,
and one identity row per record carries its identifiers beside that key:
[identity/](identity/README.md).

## Row contract

Every stage writes the same envelope:

| Column | Holds |
|---|---|
| `stage` | the stage that decided |
| `key` | the origin `SourceRowRef` |
| `role` | `outcome`, or `refused` for an alternative the stage weighed and rejected; declared once per code and filled from it by `stageRow`, never stated by a stage |
| `code` | a reason code from the generated list |
| `params` | per-instance detail (source id, component letter, sibling) |
| `evidence` | `SourceRowRef`s cited, each once and never the origin row (`evidenceTexts`, which `stageRow` applies) |

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
  nothing compressed. A stage recording a fact about a pair of records
  writes rows only for the pairs it holds for, so there a missing row means
  the fact does not hold ([Overlap lineage](../overlap/README.md#overlap-lineage)).
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
row key — never a path string. A source whose key names a group of rows
(WDS, ORB6, the MSC orbits, Gaia NSS) is cited as `{ source, key, lines }`
instead, every line of the group carried. A source's licence is credited once, on the
site's credits surface; whether a public lineage surface must also filter its
citations by licence is the release design's question, and the filter would
be a join on `source`.

Its text form is `<source>:<row>` (`<source>:<key>` for a group). Every lineage file sorts by the byte
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
appear, what holds while it does not, and its allowed exceptions: a rule, a
predicate over the row's `params` (`lineageInvariant`; `NO_EXCEPTIONS` for a
zero-pin), or a list of named rows with what each is
(`namedExceptionsInvariant`). A row is named by its own key, or — for a stage
whose key alone recurs on rows of one code, a row about a pair of records
keyed on one of them — by its key and params together (`namedRowsInvariant`, each listed as
`namedRow(key, params)`, a type a plain key cannot pass for); any other row
fails, whatever it shares with a listed one. A named row no line carries any more fails the check too,
naming it, so the list only shrinks: a
known defect fixed upstream is deleted from it in the same change. A stage
declares its invariants beside its codes and hands them to `stageLineage`,
which checks every line before emission: a violation is a failed check, so
nothing lands, and the message lists the offending rows' keys and params.
Classic-IDs' (`CLASSIC_ID_INVARIANTS`): no `unweighed-no-pulled-row` row
([The gate's evidence has to be pulled](../classic-ids/README.md#the-gates-evidence-has-to-be-pulled)).
Placement's (`PLACEMENT_INVARIANTS`): no `distance.bailer-jones-absent` row.
Naming's (`NAMING_INVARIANTS`): no `dc.none` row.
Resolve's (`RESOLVE_INVARIANTS`): named rows alone for the two
`audit.*.unbound-ambiguous.refused` codes
([Resolve lineage](/scripts/binaries/resolve/README.md#resolve-lineage)).
Astrometry's (`ASTROMETRY_INVARIANTS`): named rows alone for
`route.unresolved.identifier-bound`
([Astrometry lineage](/scripts/binaries/astrometry/README.md#astrometry-lineage)).
Orbits' (`ORBITS_INVARIANTS`): named rows alone for the four
`passed.*.unreadable` codes
([Orbits lineage](/scripts/binaries/orbits/README.md#orbits-lineage)).
Anchors' (`ANCHORS_INVARIANTS`): named rows alone for
`binding.promotion-anchor-unreached`
([Anchors lineage](/scripts/binaries/multiples/README.md#anchors-lineage)).
Masses' (`MASSES_INVARIANTS`): named rows alone for `read.unparsed`
([Masses lineage](/scripts/binaries/multiples/README.md#masses-lineage)).
Runtime-pairs' (`RUNTIME_PAIRS_INVARIANTS`): named rows alone for
`dropped.duplicate-relation`
([Runtime-pairs lineage](/scripts/binaries/README.md#runtime-pairs-lineage)).
Promotion's (`PROMOTION_INVARIANTS`): no `brightness.anchor-collocated` row,
and named rows alone for two codes
([Promotion's invariants](../companions/promotion-lineage/README.md#promotions-invariants)).
Overlap's (`OVERLAP_INVARIANTS`): named pairs alone, by key and params
([Overlap lineage](../overlap/README.md#overlap-lineage)).
Membership's (`MEMBERSHIP_INVARIANTS`): no `admit.magnitude.withheld` row
([The additions](../membership/additions/README.md#grouping-and-admission)), and no
`binding.unweighed-no-pulled-row` row
([The candidates have to be in the astrometry pull](../membership/binding/README.md#the-candidates-have-to-be-in-the-astrometry-pull)).

## Counts fold from lineage

A stage's count-snapshot keys are its reason codes, so the code list is the
one owner of every counted tier. `foldStageLines(codes, lines)`
(`lineage-row-pure.ts`, over `../../util/counts/tally-pure.ts`'s `fold`) counts a
stage's lines per live code, every live code present, typed
`Record<code, number>` from the stage's `live` codes — a retired,
historical or admission code ([Reason codes](reason-codes/README.md#the-rules))
is no key, and a line carrying one throws; each code is declared in
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

The file format, every stage's measured size and write-time budget, and how the lines are held in the heap: [storage/](storage/README.md).
The committed form of lineage is `data/sid/events.tsv` plus the ledger views
([Committed ledgers become views](#committed-ledgers-become-views)); the
derivation itself is a build artifact, regenerated every build.

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

**A stage's emission carries the diff's tally by kind, never its lines.**
`build:catalog` holds every stage's emission until its one `emitArtifacts`
call, so changed lines kept there would stay live through every later stage
and count against the [CI heap budget](../../util/heap-budget/README.md):
464,466 changed brightness-colour keys (929,228 lines) hold about 500 MiB
(measured 2026-11-11). The lines live only between the diff and its text.

## Trace

`pnpm run trace`, every stage's rows for the records a query names, lives in
[trace/](trace/README.md).

## Cross-stage joins

One stage's rows join another's on the origin key, never on a
re-derivation. A `pairs` row is keyed on its pair's founding row, which no
other stage keys on; trace reaches it through the Gaia sources and `hip:`
designations its `params` carry. A `multiples.tsv` component founds no record, so its
component-binding rows are keyed on its row (`multiples:<system_id>/<comp>`,
a promoted companion's own key) and reached, as classic-ids' rows are, by the
designations their `params` carry
([Binding lineage](/scripts/binaries/resolve/README.md#binding-lineage)).
The membership change report's `multiples` column is a match by value: the
record's HIP on the identity row — the current build's, or the baseline's for
a key the build removed — against the committed `multiples.tsv`'s `hip`
column, which carries the same identifiers and origins the component-binding
rows do.

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
one row type. Every one is a view now: the first four of membership's
([Membership lineage](../membership/README.md#membership-lineage)), the two
classic-ID queues of `classic-ids`' ([Classic-ID lineage](../classic-ids/README.md#classic-id-lineage)),
and `parked-ledger.tsv` of placement's ([Placement lineage](../distance/README.md#placement-lineage)).

## The component-binding stage

`build:binaries` is the first stage, run before classic-ids: each
`multiples.tsv` component's Gaia and HIP binding, its own or copied from a
named token of its system. Its contract lives beside its module, in
[Binding lineage](/scripts/binaries/resolve/README.md#binding-lineage).

## The resolve stage

`build:binaries` writes it after component-binding: each WDS component's
resolve tier, every candidate a cascade gate refused, and its part in each
binding-integrity verdict, keyed on its `multiples.tsv` row. Its contract lives
beside its module, in
[Resolve lineage](/scripts/binaries/resolve/README.md#resolve-lineage).

## The astrometry stage

`build:binaries` writes it after resolve: each WDS component's Stage 3 route,
citing the row it read, and each AT-HYG match the sibling guard refused,
keyed on its `multiples.tsv` row. Its contract lives beside its module, in
[Astrometry lineage](/scripts/binaries/astrometry/README.md#astrometry-lineage).

## The orbits stage

`build:binaries` writes it after astrometry: each pair's Stage 4 orbit source,
citing the row chosen, and every candidate row passed over with the rule that
passed it, keyed on the pair's founding row. Its contract lives beside its
module, in [Orbits lineage](/scripts/binaries/orbits/README.md#orbits-lineage).

## The pairs stage

`build:binaries` writes it too, after orbits: every WDS pair row
the binaries stages decide — a duplicate, a blank row left out, each Stage 5
verdict, a position-less drop — keyed on the row that founded the pair. Its
contract lives beside its module, in
[Pairs lineage](/scripts/binaries/README.md#pairs-lineage).

## The anchors stage

`build:binaries` writes it after pairs: each system's Stage 6 anchor, the
kept primaries it outranked with the rank step, and whether promotion can
anchor on it, keyed on the anchor's `multiples.tsv` row. Its contract lives
beside its module, in
[Anchors lineage](/scripts/binaries/multiples/README.md#anchors-lineage).

## The masses stage

`build:binaries` writes it after anchors: each `multiples.tsv` row's
spectral-type mass, the branch it was read off and what it fed, keyed on the
row. Its contract lives beside its module, in
[Masses lineage](/scripts/binaries/multiples/README.md#masses-lineage).

## The classic-ids stage

`build:classic-ids` is the stage after masses, run before membership; its contract
lives beside its module, in [Classic-ID lineage](../classic-ids/README.md#classic-id-lineage).

## The membership stage

`build:membership` is the stage after classic-ids; its contract lives
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

`build:catalog`'s companion promotion is the stage after coherence; its
contract lives beside its module, in [Promotion lineage](../companions/promotion-lineage/README.md#promotion-lineage).

## The overlap stage

`build:catalog`'s overlap gate is the stage after promotion: one row per
pair of records drawn inside one another, keyed on one of the two. Its
contract lives beside its module, in [Overlap lineage](../overlap/README.md#overlap-lineage).

## The runtime-pairs stage

`build:binaries-runtime` writes it, after naming: every `multiples.tsv`
pair's fate in `binaries.bin`, keyed on the pair's secondary row. Its
contract lives beside its module, in
[Runtime-pairs lineage](/scripts/binaries/README.md#runtime-pairs-lineage).
