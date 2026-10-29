# Record lineage — the per-record chain of custody

Every pipeline stage's decision about every record, kept as a row with its
reason code and the source rows it rests on, so any star traces from the
shipped record back to the catalogue rows it came from and every change
between two builds is explained. This README is the design contract the
folder's code is built to.

A stage returns a typed outcome per record; lineage is those outcomes
serialised. The target is that a stage's count snapshot folds from the same
outcome arrays, so a snapshot and lineage are two projections of one value
and neither is kept in step with the other. Membership is part-way there:
its review-queue and label-drop counts fold from the outcomes, while the
derivation, admission and component counters are still kept by hand beside
them (stellata-hhaw.45.23).

## Files in this area

```
scripts/catalog/lineage/
  lineage-row-pure.ts            The envelope, its one comparator
                                 (compareLineageRows), the TSV text form, and
                                 stageLineageText — the writer, which refuses
                                 a code the stage does not declare or rows
                                 out of order.
  reason-codes-pure.ts           stageCodes: a stage's codes with their
                                 effect and status.
  lineage-diff-pure.ts           diffLineage, the merge-join; stageDiffText,
                                 the diff file.
  lineage-header-pure.ts         StageHeader; planBaseline and judgeBaseline,
                                 which baseline a build diffs against.
  identity-pure.ts               The identity row and its file; refuses two
                                 records on one key.
  lineage-stages.ts              LINEAGE_STAGES, every stage's codes in
                                 pipeline order.
  reason-code-list-pure.ts       reasonCodeList, the generated list, and
                                 appendOnlyViolations.
  reason-codes-tsv.ts            REASON_CODES, the list's codec.
  generate-reason-codes.ts       `pnpm run lineage:codes`.
  reason-codes.test.ts           The list equals its generation, and is
                                 append-only against the merge-base.
  trace-pure.ts (+ test)         The query parse and the record search.
  trace.ts                       `pnpm run trace` (#trace).
  stage-lineage.ts               stageLineage: one stage's files, header,
                                 baseline plan, diff and budget check,
                                 ready for the stage's emitArtifacts call.
  lineage-io.ts                  The on-disk layout (build/lineage/,
                                 lineage.previous/, lineage-diff/), the
                                 baseline members and a stage's emission,
                                 gzip, and the header with its input hash.
  lineage-core-pure.test.ts      Order, writer refusal, diff, baseline verdict.
  lineage-rotation.test.ts       Rotation over a scratch build/: a failed or
                                 absent emission moves nothing, another
                                 stage's files are never touched.
  spine-origin-key.test.ts       The spine origin key is unique and stable.
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

The spine's line number is stable because the file is frozen and
byte-guarded, and it covers Sol, whose identifier cells are empty; its
identifier cells are not the key, since a curated correction can rewrite
`tyc`. The lineage core proves the key unique and identical across two
builds before anything relies on it, and keeps that as a regression test.

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
allocation's. A record membership does not admit — a folded spine row, a
component group — still gets one, keyed on the cells it arrived with, so
trace finds it. The ledger views and trace take their key columns from
this row, never re-deriving them — except where the deciding stage's input
cells ARE the ledger's key: `binding-review.tsv` keys on the spine cells
the derivation weighed, which its curated dispositions join on, so those
ride the binding row's `params`. A parked or dropped record never gets an
index or a SID: both columns are a tagged variant, a value or `none` with
the reason code that removed the record, never an empty cell.

The manifest's five-cell tuple (`tyc`/`hip`/`hd`/`gl`/`gaia_source_id`) is
not the key: it changes exactly when a binding or label decision changes, so
a re-bind would diff as one record deleted and another added. The SID is not
the key either: mints and merges are what the diff exists to show.

A new Gaia data release changes magnitude-term origin keys. That is a real
identity change and travels as SID merge and retire events (below), not as
re-keyed lineage.

## Row contract

Every stage writes the same envelope:

| Column | Holds |
|---|---|
| `stage` | the stage that decided |
| `key` | the origin `SourceRowRef` |
| `role` | `outcome`, or `refused` for an alternative the stage weighed and rejected |
| `code` | a reason code from the generated list |
| `params` | per-instance detail (source id, component letter, sibling) |
| `evidence` | `SourceRowRef`s cited, written only when they name something other than the origin row |

- Each stage declares its own payload columns next to its reason codes and
  serialises its outcome union through one function, so a variant with no
  row mapping fails typecheck.
- A refused alternative is a row of its own, never a nested list, so a
  choice diffs line by line.
- A stage writes a row for every record. A stage that can leave a record
  untouched gives it `<stage>.not-applicable`, a variant of its outcome
  union; a stage that decides every record it sees — membership admits,
  folds or ledgers each one — has no such variant, since a code nothing
  emits is a placeholder. A missing row then always means the record left
  that stage, never a silent pass-through; identical-code rows cost almost
  nothing compressed.
- SID, record index and designations live on the identity row only; the
  build version lives in a per-build header file. Repeating them on every
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
order of that text form, then `role`, `code`, `params`, through one
comparator the writer and the diff both import (`compareLineageRows`,
`lineage-row-pure.ts`) — never a numeric sort, so
Gaia ids above 2^53 order the same everywhere. A key's rows diff as a set:
changed means the set of rows under one key differs. `params` is empty or a
JSON object whose keys keep the stage's declared order, so one payload has
one text; `evidence` is its references' text forms joined by `|`.

## Reason codes — closed, append-only, generated

- One code per outcome-producing branch: two records with one code were
  decided for the same reason by the same code path. Per-instance detail goes
  in `params`, never the code.
- Each stage declares its codes in its own module as `stage.rule-branch`
  (`stageCodes`), and `lineage-stages.ts` lists every stage. The committed
  code list, `data/lineage/reason-codes.tsv`, is generated from those
  declarations by `pnpm run lineage:codes` and checked by CI
  (`reason-codes.test.ts`), never hand-edited.
- A Python stage, with no compiler to force the mapping, declares its codes
  in a small data file beside it that the generator also reads, and a
  Python test checks that every outcome value it can emit maps to a row.
- An entry carries the code, its stage, its declared effect (removal and
  re-bind codes: retire, park or merge; `none` for every other code), a
  one-line description, the version that first shipped it — the package
  version of the tree that first generated it — and its status — `live`, `retired` (with
  the version that retired it) or `historical`, declared beside the code as
  a closed union. Historical codes carry legacy causes and are never mapped
  onto live ones.
- Codes are added and marked retired, never edited or reused. A behaviour
  change — the rule now picks different records — mints a new code; a fix
  that leaves the picked set unchanged keeps its code. CI diffs the
  generated list against its merge-base copy and fails if any code there is
  missing, renamed, or has a changed stage, effect, description or first
  version, or a status moving any way but live to retired.
- No placeholder codes. A stage gets its real codes before any change
  orphans a SID through it; an `*.unrecorded` code would be written into
  append-only `events.tsv` for good.

## SID events

SID allocation is a lineage stage. Per object it records resolved (through
which designation), minted, merged (into which SID, survivor by
`docs/sid.md` [§ 4.3](/docs/sid.md#43-ledger--datasidledgertsv)) or orphaned. An orphan inherits its cause from
the upstream decision that removed or re-bound its record, joined on the
origin key.

Allocation is the sole writer of `data/sid/events.tsv`, apart from the
one-time migration of the legacy retirement files
([below](#committed-ledgers-become-views)) — `sid`, date, event
(`mint`|`retire`|`reinstate`|`merge`), code, params, successor, build
version — append-only and guarded like the ledger. Events follow from the
declared effect of the upstream code:

| Cause | Event |
|---|---|
| a new object | `mint`, coded by the route that admitted the record |
| upstream effect `retire` | `retire` |
| upstream effect `merge` | `merge`, with the successor SID |
| upstream effect `park` | none: the SID stays in the ledger, absent from this build ([§ 4.4](/docs/sid.md#44-allocation)) |
| a retired class reappears | `reinstate` |

Fail closed: an orphan whose cause has no code, or whose upstream decision
is not in that build's lineage, fails `sid:allocate` and `sid:check`. CI checks every event row's
code is in the list, declares that effect, and matches a decision in the
build's lineage.

## Storage and cost

`build/lineage/<stage>.tsv.gz`: gzip level 1, sorted by key, every record at
every stage, no reduced-detail mode.

A design-time probe on 1M synthetic rows (2026-10-21) chose the format: the
bulk is Gaia ids, which no format compresses much, and Parquet with zstd
came out about 15% smaller at five to nine times the write cost and the
loss of `zgrep`. Its per-stage size is not a sizing figure: plan a new
stage from the measured budget below, and every build prints its own
(`<stage> lineage: N bytes gzipped`). With `build/lineage.previous/` a
checkout holds about twice the current build, and each new worktree copies
one build's worth in.

The real stages' write time and disk are pinned as a budget: each stage
passes `stageLineage` (`stage-lineage.ts`) a `LineageBudget`, and a run over
it fails its emission. Membership, measured 2026-10-29 on the full tree:
1,355,182 rows (128 MB plain, 15.1 MB gzipped) plus 976,040 identity rows
(85 MB, 22.3 MB), 37.4 MB together. The timed window is everything lineage
adds to the build — the header's input hash, the diff, rendering and gzip:
about 4.3 s with a diff against a full baseline, 1.7 s without one.
A spine derivation's row carries only its winner, route and component
letters; the binding-review columns ride the rows the queue lists — a
contested or collision verdict and a disposition — since the candidates and
refusals are rows of their own. `MEMBERSHIP_LINEAGE_BUDGET` pins 41 MB and
15 s — the time ceiling sits well above the measurement because CI runners
write slower than a workstation.

The committed form of lineage is `data/sid/events.tsv` plus the ledger views
below; the derivation itself is a build artifact, regenerated every build.

## Run-to-run diff

The baseline is kept per stage in `build/lineage.previous/`, and what a
branch's report needs is the whole change against main, so a **clean build
at the merge-base is pinned there**: while `lineage.previous/` holds one,
every later build diffs against it and leaves it in place (`planBaseline`).
Otherwise the stage's current `<stage>.tsv.gz` replaces
`build/lineage.previous/<stage>.tsv.gz` in the same emitArtifacts commit
that renames the stage's new file into place, and the build diffs against
that last build if it is the merge-base's. A stage that fails, is skipped by
its content-hash stamp, or does not run (a standalone `build:membership`, a
separate `sid:allocate`) leaves both its copies untouched.

A fresh worktree is seeded with the main checkout's last `build/lineage/`
(`.worktreeinclude`), which may come from an older commit. So each stage
writes a header beside its files, `<stage>.header.json`, recording the
build version, the commit, whether the tree had uncommitted edits, and the
content hash of the inputs the stage was built from (`stepInputPaths`, `../../util/step-inputs.ts`); a header per
stage is what lets one stage rotate without rewriting another's. The diff
refuses a baseline whose commit is not the branch's merge-base with main, or
that was built over uncommitted edits — its commit then names code it was
not built from
(`judgeBaseline`, `lineage-header-pure.ts`). The refusal names the
baseline's commit and how to get a matching one; `--any-baseline` accepts it
anyway, and `--against <dir>` diffs against that directory instead. A
refused diff fails nothing: the stage's lineage still lands, no diff is
written, and a stale one is deleted, so a missing report is visible rather
than out of date. A stage diff is a merge-join of two files sorted by that
one comparator: keys added, removed and changed.

Every stage diff writes `build/lineage-diff/<stage>.tsv` — outside
`build/lineage/`, so a worktree's seed never carries another checkout's
diff; the membership change report is the first. One line per row that
differs within a changed key: `change` (added / removed / changed), `side`
(`-` baseline, `+` current), the six envelope columns, then any column the
stage joins on from another stage's facts. A PR whose build leaves a
non-empty diff puts that diff's summary in its PR body.

## Trace

`pnpm run trace <name | designation | sid | gaia id> [--dir <dir>]`
(`trace.ts`, over `trace-pure.ts`; `--dir` reads another lineage directory,
`build/lineage/` by default). `parseTraceQuery` tells the four apart: ten or
more bare digits, or `gaia_dr3:<id>`, is a Gaia id (a SID never runs that
long); fewer, or `sid:<n>`, a SID; `ns:key` a designation; anything else a
name.

1. A name resolves to its record's `hip:` and `gaia_dr3:` designations
   through `catalog-lookup.ts`'s `lookupByName`, so it needs a built
   catalogue; designations follow `sid-pure.ts`'s grammar; a SID resolves
   to its canonical key through the ledger.
2. Find the origin keys whose identity rows carry that designation. Parked
   and dropped records have lineage rows too, so they are found. Also find
   every row that names it in `params` or `evidence` — a source a gate
   weighed and refused, or only cited, sits on no identity row. A full scan
   of the stage files, about two seconds today, so no index is kept.
3. Widen to the same-as class, and to retired SIDs and their successors,
   through allocation's rows — once allocation is a lineage stage.
4. Print every stage's rows for those keys in stage order
   (`LINEAGE_STAGES`).

`trace.test.ts` runs the command over a small committed fixture: it finds a
record the catalogue parks and the record that refused a source no identity
row carries.

## Cross-stage joins

Every join is on the origin key, never a re-derivation. The binaries
`Binding` provenance type must carry a component's `(system_id, comp)` and
its HIP, which is what the membership change report joins a re-bound row
onto; until that type lands, the join reads `multiples.tsv`'s existing
columns.

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
first four are views now ([The membership stage](#the-membership-stage)).

## The membership stage

`build:membership` is the first stage with lineage
(`../membership/membership-lineage-pure.ts`). `buildMembership` returns a
keyed outcome per decision — admission, fold, component, the spine
derivation's verdict with every candidate it refused, a disposition, an
addition's binding, each label flip and label drop — and
`membershipLineageRow` is the one serialiser, its `switch` exhaustive so a
new variant without a row fails typecheck. `ParamsOf` declares each code's
params beside the codes; the writer and the views both read through it, so
a renamed key fails typecheck on both sides. Every record gets an admission
row. `membershipLedgers` generates the four ledgers from those rows and the
identity rows alone, byte-identical to the files they replaced as writers.

Curated human input stays hand-written and is read by the build or its
tests: `binding-review-dispositions.tsv`, `spine-corrections.tsv`,
`hd_hip_route_disagreements_review.tsv`, `classic_id_overrides.tsv`,
`sameas-overrides.tsv`. `data/sid/ledger.tsv` keeps its own contract;
`retirements.tsv` and `reinstatements.tsv` migrate into `events.tsv` under
historical codes, one per distinct legacy cause, and both files are deleted
in that PR. Retired state is still decided by counting retire against
reinstate rows per SID. The migration needs the one-time edit to the ledger
guard that `docs/sid.md` [§ 4.5](/docs/sid.md#45-ci-guard) reserves for owner
sign-off; the owner gave it on 2026-10-21 by choosing this migration.
