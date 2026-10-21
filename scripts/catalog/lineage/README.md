# Record lineage — the per-record chain of custody

Every pipeline stage's decision about every record, kept as a row with its
reason code and the source rows it rests on, so any star traces from the
shipped record back to the catalogue rows it came from and every change
between two builds is explained. This README is the design contract the
folder's code is built to.

A stage returns a typed outcome per record; lineage is those outcomes
serialised. The count snapshots fold from the same outcome arrays in memory,
so a snapshot and lineage are two projections of one value and neither is
kept in step with the other.

## Identity — the origin source row

Every row is keyed on the record's **origin**: a `SourceRowRef` naming the
source row that founded the record.

| Record founded by | Origin key |
|---|---|
| a spine row | the spine's row key |
| an addition group | the group anchor's source row; the other members are evidence |
| a magnitude-term row | its Gaia DR3 `source_id` |
| a promoted companion | its `multiples.tsv` `(system_id, comp)` |

Record index and SID are attributes, never keys. One **identity row** per
record carries: the origin key, the record index (after the apparent-V
sort), the SID (from allocation), the manifest's current five-cell tuple
(`tyc`/`hip`/`hd`/`gl`/`gaia_source_id`, with the bound Gaia id), and the
full designation set. The ledger views and trace take their key columns
from this row only, never re-deriving them. A parked or dropped record
never gets an index or a SID: both columns are a tagged variant, a value or
`none` with the reason code that removed the record, never an empty cell.

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
- SID, record index and designations live on the identity row only; the
  build version lives in a per-build header file. Repeating them on every
  stage row roughly doubles each stage file.

### SourceRowRef

`{ source, row }`: `source` is the source's declaration constant (the
`defineSource` constant the typed input boundary introduces) and
`row` is that source's typed row key — never a path string. Licence is a
property of the source constant, so filtering a row's citations — its key
and its evidence — by licence for a public surface is a join on `source`.

Its text form is `<source>:<row>`. Every lineage file sorts by the byte
order of that text form, then `role`, `code`, `params`, through one
comparator the writer and the diff both import — never a numeric sort, so
Gaia ids above 2^53 order the same everywhere. A key's rows diff as a set:
changed means the set of rows under one key differs.

## Reason codes — closed, append-only, generated

- One code per outcome-producing branch: two records with one code were
  decided for the same reason by the same code path. Per-instance detail goes
  in `params`, never the code.
- Each stage declares its codes in its own module as `stage.rule-branch`.
  The committed code list is generated from those declarations and checked
  by CI, never hand-edited.
- An entry carries the code, its stage, its declared effect (removal and
  re-bind codes: retire, park or merge), a one-line description, the
  version that first shipped it, and its status — `live`, `retired` (with
  the version that retired it) or `historical`, declared beside the code as
  a closed union. Historical codes carry legacy causes and are never mapped
  onto live ones.
- Codes are added and marked retired, never edited or reused. A behaviour
  change — the rule now picks different records — mints a new code; a fix
  that leaves the picked set unchanged keeps its code. CI diffs the
  generated list against its merge-base copy and fails if any code there is
  missing, renamed, or has a changed stage, effect or description.
- No placeholder codes. A stage gets its real codes before any change
  orphans a SID through it; an `*.unrecorded` code would be written into
  append-only `events.tsv` for good.

## SID events

SID allocation is a lineage stage. Per object it records resolved (through
which designation), minted, merged (into which SID, survivor by
[docs/sid.md § 4.3](/docs/sid.md#43-ledger--datasidledgertsv)) or orphaned. An orphan inherits its cause from
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

Measured once (2026-10-21, a throwaway probe; the pinned budget supersedes
it) on 1M synthetic rows of this shape: 67 MB plain, 13.6 MB compressed
in 0.2 s per stage — about 200 MB and a few seconds for fifteen stages. With
`build/lineage.previous/` a checkout holds about twice that, and each new
worktree copies one more build's worth in. The
bulk is Gaia ids, which no format compresses much: Parquet with zstd came to
11.5 MB in 1.2 s, not worth six times the write cost and the loss of
`zgrep`. The real stages' write time and disk are pinned as a budget.

The committed form of lineage is `data/sid/events.tsv` plus the ledger views
below; the derivation itself is a build artifact, regenerated every build.

## Run-to-run diff

The baseline is the last build in this checkout, kept per stage: a stage's
current `<stage>.tsv.gz` replaces `build/lineage.previous/<stage>.tsv.gz` in
the same emitArtifacts commit that renames the stage's new file into place.
A stage that fails, is skipped by its content-hash stamp, or does not run
(a standalone `build:membership`, a separate `sid:allocate`) leaves both its
copies untouched. A fresh
worktree is seeded with main's `build/lineage/` (`.worktreeinclude`), so its
first build diffs against main. `--against <dir>` overrides the baseline. A
stage diff is a merge-join of two files sorted by that one comparator: keys
added, removed and changed.

## Trace

`pnpm run trace <name | designation | sid | gaia id>`:

1. A name resolves to designations through `catalog-lookup.ts`'s
   `lookupByName`; designations normalise through `sid-pure.ts`'s
   namespaces; a SID resolves through the ledger.
2. Find the origin keys whose identity rows carry that designation. Parked
   and dropped records have lineage rows too, so they are found.
3. Widen to the same-as class, and to retired SIDs and their successors,
   through allocation's rows.
4. Print every stage's rows for those keys in stage order.

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
one row type. Each view moves when its writing stage gains lineage.

Curated human input stays hand-written and is read by the build or its
tests: `binding-review-dispositions.tsv`, `spine-corrections.tsv`,
`hd_hip_route_disagreements_review.tsv`, `classic_id_overrides.tsv`,
`sameas-overrides.tsv`. `data/sid/ledger.tsv` keeps its own contract;
`retirements.tsv` and `reinstatements.tsv` migrate into `events.tsv` under
historical codes, one per distinct legacy cause, and both files are deleted
in that PR. Retired state is still decided by counting retire against
reinstate rows per SID. The migration needs the one-time edit to the ledger
guard that [docs/sid.md § 4.5](/docs/sid.md#45-ci-guard) reserves for owner
sign-off; the owner gave it on 2026-10-21 by choosing this migration.
