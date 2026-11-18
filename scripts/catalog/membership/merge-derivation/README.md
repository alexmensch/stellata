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
                             applying ../pair-review-dispositions-pure.ts's
                             dispositions over the queue,
                             simbadRefusedMoves and requestedTycHds (SIMBAD's
                             TYC→HD check on the applied moves) and
                             mergeDivergences, one row's divergences with
                             each differs and unlinked cell's verdict. Pure.
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

**The pair rule, the owner's (2026-11-14, extended 2026-11-17): Gaia decides,
else HIP2's position, else review.** Of the entries naming a HIP, the one whose
Gaia TYC cross-match names the same source as the HIP's own cross-match takes
the HIP and its HD. Where Gaia cross-matches the HIP to no source at all, the
entry HIP2's position falls on alone takes it
([The positional witness](../positional-witness/README.md#the-two-witnesses),
`positionWitness` in `PairLinks`). Where neither names one entry — a HIP source
on no entry or on more than one, or HIP2's position on none or on both — the
row is queued with the entries and the reason, and the spine's choice ships
while it waits. HIP2's position is asked only where Gaia names no source for
the HIP.
IV/25's HD link does not vote: on a pair Tycho-2 resolved, an HD names a
photographic blend, while the two cross-matches are positional fits to each
star.

## Applying the pair rule

`applyPairRule` runs on the kept spine rows before anything else reads them, so
the binding derivation, the label merge and the additions all see the moved
rows. `build:astrometry-request` requests both arrangements — the rows as
they stand and with every move applied, Gaia's and the position's
(`applyEveryPairMove`) — so
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

Each move names its witness (`PairWitness`): a Gaia move's lineage evidence is
the HIP's source, a position move's every entry's separation from HIP2's
carried position, under its own codes (`merge.pair.position.*`).

**A Gaia move stands only where the moved record binds the HIP's source.** The
binding derivation ([Both gates weigh every candidate](../binding/README.md#both-gates-weigh-every-candidate))
runs on the record as the move would leave it; where it ships anything but the
source Gaia's two cross-matches named — the magnitude gate finding G more than
a magnitude below the record's printed V, or SIMBAD giving the source to
another component — Gaia contradicts itself, so the HIP is queued
(`gate_refused`) rather than moved. On those pairs Gaia's HIP cross-match
most likely names the fainter star. A position move has no source for the
gates to hold it to.

**A move — Gaia's or the position's — stands only where SIMBAD names the new
entry by the HD the record ships.** After the label merge, a moved record's TYC and its HD must not name
different components: where SIMBAD's TYC→HD pull
([What the TYC → HD pull adjudicates](../../simbad/README.md#what-the-tyc--hd-pull-adjudicates))
names the owner entry by HDs that leave out the record's shipped HD, the
witness that named the entry is contradicted, and the HIP is queued
(`simbad_refused`). SIMBAD
naming no HD for the entry is silence, not agreement or dissent, and the move
stands. The shipped HD is an output of the label merge, which runs on the
moved rows, so `settlePairRule` runs the pair rule, the binding settlement
and the merge, takes the refused HIPs out of the move set
(`simbadRefusedMoves`), and runs them again until no move is refused; each
pass only adds HIPs, so it ends. <!-- count:membership-manifest/membership.merge.pair.review.simbad-refused-move -->6<!-- /count --> are refused and
undisposed today. Measured 2026-11-17 over the 8 refused then,
two of them position moves (HIP 83608, HIP 110778): two passes, the first
refusing all of them and the second none, each pass re-deriving the spine's
bindings. Each is refused again with every other already refused, and none of
them refuses another, so the refused set does not depend on the order passes
find them in. The check reads only
the entries the pull asks for every pair it knows — IV/25's, and every
entry of a Tycho-2 pair (`pairEntries`), which is where a position move lands
off IV/25 (`pairRuleTycHdRequest`, the one set the pull also builds its
request from) — through `requestedTycHds`, and fails the build on any other.
The pair entries come off the Tycho-2 slice the manifest selects, so this
loop runs through the Tycho-2 one
([Loops through committed files](../../../pipeline/README.md#loops-through-committed-files)).

**A move can free the HD IV/25 printed for the entry it lands on**, as a
close-pair correction does
([What a freed number costs](../../classic-ids/label-merge/README.md#what-a-freed-number-costs)).
HIP 47108 (HD 83231) moves on its position onto TYC 7167-1508-1, which SIMBAD
calls HD 83231 and IV/25, crossed, HD 83232. Read uncorrected, the addition
IV/25 made of 7167-1508-1 as HD 83232 falls away and HD 83232 ships on no
star; the curated IV/25 correction re-points the pair's two HDs, so HD 83232
lands on 7167-716-1, its own star
([Crossed HD numbers in IV/25](../../classic-ids/README.md#crossed-hd-numbers-in-iv25)).

A row the rule queues keeps the spine's entry while it waits.
`mergeDivergences` refuses a row the rule would still move, so a move cannot
be reported without being applied.

## The pair-review queue

`data/membership/pair-review.tsv`, keyed on the record's five identifier cells,
one row per HIP the pair rule names no owner for: `entries`, every Tycho-2
entry naming the HIP, and `reason` — `unwitnessed`, `no_entry_matches`,
`several_match`, `gate_refused` or `simbad_refused`, as
[Applying the pair rule](#applying-the-pair-rule) defines them. It is a view of
the `merge.pair.review.*` lineage rows, and the spine's entry ships on every
row it lists until a disposition settles it.

## Disposing a queued pair

`data/membership/pair-review-dispositions.tsv` is hand-written and read by
`build:membership`, which never writes it: `hip`, `entries` (the queue row's,
restated), `keep_entry`, `basis` and `evidence`, the shape of the binding
queue's dispositions ([A disposition is the authority](../binding/README.md#a-disposition-is-the-authority-wherever-one-keys-a-row))
with a closed `basis` set of its own (`PAIR_DISPOSITION_BASES`):
`tycho2_photometry` and `hip2_position`, both recomputed below, and
`pair_component` (the HIP names the unresolved system; which entry carries it
rests on the evidence alone).
A disposition is the authority: the build puts the HIP on `keep_entry` the way
a Gaia move would — the record onto that entry, or the HIP onto the spine
record already there — and no gate weighs it again (`merge.pair.disposed`,
`merge.pair.disposed-record`, the second ledgered as a `pair_moves` row so
gate (i) matches it). The build fails on a disposition whose `entries` no
longer match the pair, so a Tycho-2 or Gaia change reopens the review; on a
`keep_entry` off the pair; and on a HIP the rule does not queue once the
SIMBAD passes settle, since a `simbad_refused` HIP is an ordinary move until a
later pass queues it.

**`tycho2_photometry` is recomputed, not taken on trust.** A disposition on
that basis keeps the entry whose `VT` is nearest Hipparcos's printed V for the
HIP, and `requireWitnessedKeeps` fails the build where it does not, where
the two nearest tie, or where either magnitude is missing. It reads `VT`, not
the Johnson V the printed-V cascade reduces from `BT` and `VT`: Tycho-2 prints
no `BT` for the fainter entry of most close pairs, and a ranking of two
entries against one V needs no colour term. It settles the pairs neither Gaia nor HIP2's position can: two
Tycho-2 entries closer together than Hipparcos's position can separate, or a
resolved pair Gaia names no source for. Settling the
queue is `stellata-hooj.17.11.5`.

**`hip2_position` is recomputed too.** A disposition on that basis keeps the
entry HIP2's carried position falls on alone, inside the Hipparcos tolerance
([The two witnesses](../positional-witness/README.md#the-two-witnesses)), and
`requireWitnessedKeeps` fails the build where the witness returns `none`,
`several`, another entry, or nothing to carry. It settles the queued rows a
second witness contradicts Gaia on, or Gaia cannot separate: the pair rule
asks HIP2's position only where Gaia names no source, so on a `gate_refused`
or `simbad_refused` row the position has not yet voted.

**A position on one entry alone outranks photometry** (the owner's,
2026-11-18). `requireWitnessedKeeps` asks HIP2's position of every
`tycho2_photometry` disposition too, and fails one whose position matches the
other entry alone; a `several`, `none` or uncarried position leaves
photometry to decide. Where the two agree the disposition takes
`tycho2_photometry`; where the position names the entry photometry does not
favour, it takes `hip2_position` — HIP 3885, 36914 and 102396, whose `VT`
offsets favour the other entry by 0.009, 0.048 and 0.013 mag against a
Hipparcos V that blends both.

**A disposition places the record; it does not bind it.** The binding
derivation still gates the moved record's candidates, and a `gate_refused`
row's new entry carries exactly the source the gates refused, so the record
would ship no source while that source stays an unnamed magnitude-term row —
one star drawn twice. Each such move therefore takes a binding disposition
beside it, keeping the entry's own TYC cross-match on `tycho2_position`
(HIP 19464, 69894, 102396).

**A disposition onto an addition's entry moves the whole record.** Where the
kept entry is no spine record's but an addition's, the record and its labels
move there. The label merge then gives it the entry's own HD and HR only where
IV/25's HD for the entry wins the overlay, and the vacated entry is admitted
again under the record's old labels — HIP 3885 and 36914, which therefore end
as the HIP moving between two records. Where the overlay does not flip, the
addition folds into the record and its own HD and HR leave the catalogue.
Moving only the HIP onto an addition is `stellata-hooj.17.11.5.5`; until it
lands, such a row stays queued (HIP 83608, 84405, 110778).

## The divergence ledger

`data/membership/merge-divergence.tsv`, keyed on the record's five identifier
cells like the other ledgers, one row per divergence:

| `divergence` | `cells` | `derived` | `evidence` |
|---|---|---|---|
| `unlinked` | one cell outside the row's largest connected group | the witnessed partition | the published partition, the queue reason, and the positional witness's separation where it ran |
| `pair_moves` | `hip` | the entry the pair rule moved the HIP onto, another spine record's | the HIP's Gaia source |
| `derived_only` | the cell | the value a primary's link puts there | `held` if another spine row carries it, else `free` |
| `differs` | the cell the spine fills | the values a primary's link puts there, none of them one the record ships | the cell the link reads, and the value the record ships (`none` where a label rule emptied it) |

`unlinked` is the association audit's `witnessed` residual over the corrected
rows, one row per cell, and only for a cell no rule settles
([Settling an unlinked cell](#settling-an-unlinked-cell)). `derived_only` covers a cell the spine leaves empty and a primary fills:
a HIP through Tycho-2's column (only on the entry the pair rule names), an HD
through IV/25 or the HIP's I/239 and IV/27A links, an HR through V/50, a GJ
through CNS5's `hip` or V/70A's `HD`, each GJ written in the record's own
form. `differs` is the filled-cell side of the same links — HIP by Tycho-2's
column, HD by IV/25 and by the HIP's I/239 and IV/27A rows, HR by V/50, GJ by
CNS5 and by V/70A — read off the spine row's cells, one row per link whose
values name nothing the record ships in that cell once the label merge has
run: its display value or an alias, a GJ compared on the merge's own
[specificity rule](../../classic-ids/label-merge/README.md#the-gl-comparison-is-specificity-aware).
A spine cell the merge already moved onto the primary's value therefore
writes no row, its label flip being the decision; a pair of HDs swapped
between two records shows on both. On a pair
row IV/25's TYC→HD link does not count, since which entry the HD belongs to
is the pair rule's verdict. Rows the pair rule confirms carry
`merge.pair.confirmed` in lineage and no ledger row.

The counts are the `membership.merge.*` codes in
`../membership-manifest-expected.json`; read them there.

## Settling a differs cell

A `differs` cell is weighed by the rule that already decides that kind of
cell elsewhere in the pipeline, and **only a cell no rule settles reaches the
ledger**, where it waits for review with the shipped value standing. A
settled cell writes `merge.differs.<to>.<from>.<settlement>` in lineage and
no ledger row. The spine's value and I/239's HD are never evidence: the first
is the decision being replaced, and Hipparcos printed one HD for a pair it
did not resolve
([I/239's HD for a HIP is not a fourth opinion](../../simbad/README.md#which-witness-decides-a-close-pairs-hd)).

| Cell | Rule | Settles as |
|---|---|---|
| `hd` | the close-pair rule, `closePairHdVerdict` ([Which witness decides a close pair's HD](../../simbad/README.md#which-witness-decides-a-close-pairs-hd)) on the shipped HD | `close-pair-uncontested` (both TYC witnesses share an HD and one names the shipped value), `close-pair-refuse` (the record's source is another object than its TYC's, so the HD stands) |
| `hr` | V/50 publishes HD and HR as a pair | `v50-pair` (V/50 pairs the shipped HR with the shipped HD) |
| `gl` | a record's identity is its Gaia binding | `cns5-source` (CNS5's row for the record's own source names the shipped GJ) |
| `hip` | none | — |

Everything else queues as `merge.differs.<to>.<from>.queued`, the reason as
the evidence's last field:
`close-pair-split` (the two TYC witnesses share no HD), `close-pair-unanswered`
(IV/25 or SIMBAD has no row for the record's TYC, or it has none),
`close-pair-source-silent`, `close-pair-move` (all four witnesses name another
HD: the rule's move set, which reaches the build through
`classic_id_overrides.tsv` after review, as the rule's other moves do), or
`no-rule`.

## Settling an unlinked cell

An `unlinked` cell — one only AT-HYG joins to the rest of its row — is weighed
the same way, cell by cell: a settled cell writes
`merge.unlinked.<cell>.<settlement>` in lineage and no ledger row; anything
else is `merge.unlinked.<cell>.queued`, ledgered with its reason, the shipped
value standing while it waits.

| Cell | Settles as |
|---|---|
| any | `not-shipped`: an earlier rule — the pair rule, the label merge or a label drop — already moved the spine's value off the record, and that rule's row is the decision |
| `hd`, `hr` | the `differs` rule for the cell, above |
| `gl` | `cns5-source`, else `v70a-position`: the [positional witness](../positional-witness/README.md) puts V/70A's position for the shipped GJ inside its tolerance of the record's own Tycho-2 entry |
| `tyc`, `hip` | no rule |

A GJ the witness cannot settle queues as `v70a-none` (the entry is outside the
tolerance), `no-v70a-astrometry` (V/70A prints no position for it) or
`no-tycho2-entry`; the separation rides in the
evidence. The other reasons are the `differs` ones. The counts are the
`membership.merge.unlinked.*` codes in `../membership-manifest-expected.json`.
