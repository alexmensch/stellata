# Merge derivation — the spine's merge decisions held against the primaries

`build:membership`'s spine side held against the primaries: for every spine
row left after the corrections ([Correcting a merge decision](../spine-corrections/README.md#correcting-a-merge-decision)),
what the primaries' own links derive for its identifier cells, and where that
departs from the merge decision the spine records. **The pair rule is applied**
([Applying the pair rule](#applying-the-pair-rule)); every other divergence
changes no manifest row yet. Its output is the divergence ledger that `stellata-hooj.17.11` switches
the build onto: every row of it becomes an evidenced correction, a review
queue row, or a manifest change with a lineage row, and the spine stops being
read for merge decisions. The plan it serves is
[§ 3.2](/docs/catalog-driver.md#32-retiring-the-spines-consumers--per-column-per-consumer-in-order).

## Files in this area

```
scripts/catalog/membership/merge-derivation/
  merge-derivation-pure.ts   pairLinksFrom (the links the derivation joins on,
    (+ test)                 built over ../../spine/association-audit-pure.ts's
                             tables), pairOwner, applyPairRule (the kept rows
                             with every move applied that no gate refuses),
                             applyEveryPairMove (every move, none refused),
                             simbadRefusedMoves and iv25TycHds (SIMBAD's
                             TYC→HD check on the applied moves) and
                             mergeDivergences, one row's divergences. Pure.
```

`../membership-manifest-pure.ts` applies the pair rule to the kept spine rows
before the binding derivation reads them, then runs the derivation over them
and adds each
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

## Applying the pair rule

`applyPairRule` runs on the kept spine rows before anything else reads them, so
the binding derivation, the label merge and the additions all see the moved
rows. `build:astrometry-request` requests both arrangements — the rows as
they stand and with every Gaia move applied (`applyEveryPairMove`) — so
whichever entry a record ends on, queued or moved, its candidates were
pulled. A move changes one of two things:

- **The row's TYC**, when the owner entry is no spine record's: the record
  keeps its HIP, HD and SID and moves onto the other entry, so its position,
  V, proper motion and binding all follow the entry. `merge.pair.moves`, no
  ledger row: the record's SID and its gate (i) match ride on its HIP and HD,
  which do not move.
- **Which record carries the HIP**, when the owner entry is another spine
  record's: the HIP leaves the row and lands on that record, an identity
  event ([§ 4.3](/docs/sid.md#43-ledger--datasidledgertsv)): the receiving
  record now carries the HIP's SID key, so allocation merges its SID into the
  HIP's, and the row that lost it mints. `merge.pair.moves-record`, ledgered
  as `pair_moves`, which gate (i) reads to match both spine rows on the
  designations their records now carry (`../spine-match-pure.ts`,
  `withRecordMoves`). The receiver must carry no HIP of its own, and no two
  HIPs may move onto one entry; either fails the build.

**A move stands only where the moved record binds the HIP's source.** The
binding derivation ([Both gates weigh every candidate](../binding/README.md#both-gates-weigh-every-candidate))
runs on the record as the move would leave it; where it ships anything but the
source Gaia's two cross-matches named — the magnitude gate finding G more than
a magnitude below the record's printed V, or SIMBAD giving the source to
another component — Gaia contradicts itself, so the HIP is queued
(`gate_refused`) rather than moved. On those pairs Gaia's HIP cross-match
most likely names the fainter star.

**A move stands only where SIMBAD names the new entry by the HD the record
ships.** After the label merge, a moved record's TYC and its HD must not name
different components: where SIMBAD's TYC→HD pull
([What the TYC → HD pull adjudicates](../../simbad/README.md#what-the-tyc--hd-pull-adjudicates))
names the owner entry by HDs that leave out the record's shipped HD, Gaia's
cross-match is contradicted, and the HIP is queued (`simbad_refused`). SIMBAD
naming no HD for the entry is silence, not agreement or dissent, and the move
stands. The shipped HD is an output of the label merge, which runs on the
moved rows, so `buildMembership` runs the pair rule, the binding settlement
and the merge, takes the refused HIPs out of the move set
(`simbadRefusedMoves`), and runs them again until no move is refused; each
pass only adds HIPs, so it ends. The check reads only IV/25's entries
(`iv25TycHds`), which the pull requests whatever the manifest holds, and
fails the build on an owner entry outside IV/25
([Loops through committed files](../../../pipeline/README.md#loops-through-committed-files)).

A row the rule queues keeps the spine's entry while it waits.
`mergeDivergences` refuses a row the rule would still move, so a move cannot
be reported without being applied.

## The pair-review queue

`data/membership/pair-review.tsv`, keyed on the record's five identifier cells,
one row per HIP the pair rule names no owner for: `entries`, every Tycho-2
entry naming the HIP, and `reason` — `no_hip_source`, `no_entry_matches`,
`several_match`, `gate_refused` or `simbad_refused`, as
[Applying the pair rule](#applying-the-pair-rule) defines them. It is a view of
the `merge.pair.review.*` lineage rows, and the spine's entry ships on every
row it lists.

## The divergence ledger

`data/membership/merge-divergence.tsv`, keyed on the record's five identifier
cells like the other ledgers, one row per divergence:

| `divergence` | `cells` | `derived` | `evidence` |
|---|---|---|---|
| `unlinked` | the cells outside the row's largest connected group | the witnessed partition | the published partition |
| `pair_moves` | `hip` | the entry the pair rule moved the HIP onto, another spine record's | the HIP's Gaia source |
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
