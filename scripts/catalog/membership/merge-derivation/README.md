# Merge derivation — the spine's merge decisions held against the primaries

The shadow of `build:membership`'s spine side: for every spine row left after
the corrections ([Correcting a merge decision](../spine-corrections/README.md#correcting-a-merge-decision)),
what the primaries' own links derive for its identifier cells, and where that
departs from the merge decision the spine records. **It changes no manifest
row.** Its output is the divergence ledger that `stellata-hooj.17.11` switches
the build onto: every row of it becomes an evidenced correction, a review
queue row, or a manifest change with a lineage row, and the spine stops being
read for merge decisions. The plan it serves is
[§ 3.2](/docs/catalog-driver.md#32-retiring-the-spines-consumers--per-column-per-consumer-in-order).

## Files in this area

```
scripts/catalog/membership/merge-derivation/
  merge-derivation-pure.ts   mergeLinksFrom (the links the derivation joins on,
    (+ test)                 built over ../../spine/association-audit-pure.ts's
                             tables), pairOwner and mergeDivergences, one row's
                             divergences. Pure.
```

`../membership-manifest-pure.ts` runs it over the kept spine rows and adds each
divergence to the stage's lineage as a `merge.*` code; the ledger is a view of
those rows ([Membership lineage](../README.md#membership-lineage)), its codec
`../merge-divergence-tsv.ts`.

## Connected is not unique — the pair rule

[The association audit](../../spine/README.md#the-association-audit) asks whether
a row's cells **connect**. That leaves out the decision the spine actually
makes most often: Tycho-2's own `hip` column gives one HIP to **two** entries
of a resolved pair, so a row carrying either entry connects, and only the spine
says which entry is the HIP's record. The primaries disagree with it on that:
IV/25 gives the HD to the other entry on most of those rows, while Gaia agrees
with the spine on more than half.

**The pair rule, the owner's (2026-11-14): Gaia decides, else review.** Of the
entries naming a HIP, the one whose Gaia TYC cross-match names the same source
as the HIP's own cross-match takes the HIP and its HD. Where that names no
entry — no HIP source, no entry on it, or more than one — the row is queued
with the entries and the reason, and the spine's choice ships while it waits.
IV/25's HD link does not vote: on a pair Tycho-2 resolved, an HD names a
photographic blend, while the two cross-matches are positional fits to each
star.

## The divergence ledger

`data/membership/merge-divergence.tsv`, keyed on the record's five identifier
cells like the other ledgers, one row per divergence:

| `divergence` | `cells` | `derived` | `evidence` |
|---|---|---|---|
| `unlinked` | the cells outside the row's largest connected group | the witnessed partition | the published partition |
| `pair_moves` | `hip` | the entry the pair rule names | the HIP's Gaia source |
| `pair_review` | `hip` | every entry naming the HIP | why no owner is named |
| `derived_only` | the cell | the value a primary's link puts there | `held` if another spine row carries it, else `free` |
| `differs` | the filled cell | the values a primary's link puts there, none of them the spine's | the cell the link reads, and the spine's value |

`unlinked` is the association audit's `witnessed` residual over the corrected
rows. `derived_only` covers a cell the spine leaves empty and a primary fills:
a HIP through Tycho-2's column (only on the entry the pair rule names), an HD
through IV/25 or the HIP's I/239 and IV/27A links, an HR through V/50, a GJ
through CNS5's `hip` or V/70A's `HD`, each GJ written in the record's own
form. `differs` is the filled-cell side of the same links, one row per link
whose values leave out the spine's — HIP by Tycho-2's column, HD by IV/25 and
by the HIP's I/239 and IV/27A rows, HR by V/50, GJ by CNS5 and by V/70A — so a
pair of HDs the spine swapped between two records shows on both. On a pair
row IV/25's TYC→HD link does not count, since which entry the HD belongs to
is the pair rule's verdict. Rows the pair rule confirms carry
`merge.pair.confirmed` in lineage and no ledger row.

The counts are the `membership.merge.*` codes in
`../membership-manifest-expected.json`; read them there.
