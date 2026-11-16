# Identity — the origin source row

What every [record lineage](../README.md) row is keyed on, and the one
identity row per record that carries a record's identifiers beside that key.

```
scripts/catalog/lineage/identity/
  identity-pure.ts               The identity row, identityRow its one
                                 constructor, and its file; refuses two
                                 records on one key. RECORD_KEY_COLUMNS,
                                 the five-cell tuple every ledger keyed on
                                 a record (parked, additions, label drops)
                                 spells its columns from, and its typed
                                 form RecordIdentifiers with the cell
                                 codec those ledgers share and recordKey,
                                 the joined tuple a ledger row and a
                                 manifest row match on.
  spine-origin-key.test.ts       The spine origin key is the physical line
                                 and unique; the spine guard keeps it stable.
```

## The origin key

Every row is keyed on the record's **origin**: a `SourceRowRef` naming the
source row that founded the record. `classic-ids` runs before any record
exists, so its rows are keyed on the catalogue row stating each designation
([Classic-ID lineage](../../classic-ids/README.md#classic-id-lineage)).

| Record founded by | Origin key |
|---|---|
| a spine row | its line number in the frozen `data/athyg/inherited-spine.tsv` |
| an addition group | the group anchor's source row — its IV/25 star, else its I/239 HIP, else its CNS5 row; the other members are evidence |
| a magnitude-term row | its Gaia DR3 `source_id` |
| a promoted companion | its `multiples.tsv` `(system_id, comp)` |
| (no record) a `multiples.tsv` component's binding | its row, the same `(system_id, comp)` |
| (no record) a component a Stage 5 rejection removes from `multiples.tsv` | the rejected pair's founding row ([Pairs lineage](/scripts/binaries/README.md#pairs-lineage)) |
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

## The identity row

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
ride membership's `membership.binding.*` row's `params`. A parked or dropped record never gets an
index or a SID: it has no `allocation.sids` row, and a SID it once held
is carried by allocation's parked, retired or merged row under the deciding
origin, with that decision's code as `cause`.

The manifest's five-cell tuple (`tyc`/`hip`/`hd`/`gl`/`gaia_source_id`) is
not the key: it changes exactly when a binding or label decision changes, so
a re-bind would diff as one record deleted and another added. The SID is not
the key either: mints and merges are what the diff exists to show.

A new Gaia data release changes magnitude-term origin keys. That is a real
identity change and travels as SID merge and retire events
([SID events](../README.md#sid-events)), not as re-keyed lineage.
