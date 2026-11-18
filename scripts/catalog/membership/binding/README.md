# The binding derivation

A spine row's `gaia_source_id`, derived from committed evidence alone. The
manifest that consumes it is `../README.md`; the retirement this derivation
completes is [§ 3.2](/docs/catalog-driver.md#32-retiring-the-spines-consumers--per-column-per-consumer-in-order).

## Files in this area

```
scripts/catalog/membership/binding/
  binding-gate-pure.ts (+ test) The binding gate both the derivation and
                                ../../classic-ids/' overlay weigh a candidate
                                through: `BindingEvidence`, the G − V threshold
                                and `gMinusVRejects`, the one comparison the
                                binaries load stage's gate calls too,
                                SIMBAD's WDS cross-ID index and the
                                sibling-letter check over it, and
                                `weighBinding`'s verdict. Pure.
  simbad-wds-xids-source.ts     SIMBAD_WDS_XIDS, declared
                                (../../../util/sources/) as a column
                                table: this gate's index, the
                                simbad-wds-sptype pull's oid request and
                                the binaries load stage each read it.
  binding-evidence.ts           Loads the gate's own evidence — G per source
                                and SIMBAD's WDS component cross-IDs — and
                                `loadHipVMag`, and the identity witness's
                                positions (`positionEvidence`: HIP2 and the
                                Gaia astrometry). The printed-V lookups come from
                                the calling build, over the tables it already
                                parsed: build:membership's primaries tables,
                                build:classic-ids' `TYCHO2` / `GLIESE` reads.
  binding-derivation-pure.ts    The four candidate sources, the consensus
    (+ test)                    ranking, both gates through
                                weighBinding, the component and identity
                                witnesses, and the candidate set the
                                astrometry request has to cover. Pure, and
                                imports nothing from the manifest —
                                `../../spine/` and
                                `../../astrometry-request/` read it too.
  binding-outcomes-pure.ts      What every primaries row's derivation
                                records, spine and addition alike:
                                rowDeriver, the refused, runner-up and
                                unweighed candidates' outcomes, the identity
                                witness's, a review-queue row's cells, and the
                                unshipped candidates ownCandidates folds,
                                first row first, for the magnitude term.
                                Pure.
  spine-settle-pure.ts          settleSpineBindings: each spine row's
                                derivation, the collision rule, its queue
                                cells and the dispositions settling it,
                                with the value it ships. Pure.
  binding-review-dispositions-  The dispositions' columns, closed bases and
    pure.ts                     reader, on the same terms.
  binding-review-dispositions-  BINDING_REVIEW_DISPOSITIONS, the curated
    source.ts                   dispositions' declaration
                                (../../../util/sources/).
```

## The four sources, in precedence order

`deriveBinding` (`binding-derivation-pure.ts`) answers each spine row from four
committed sources, in precedence order:

1. **TYC** — `data/gaia/gaia_dr3_tyc_xmatch.tsv` on the record's own TYC.
2. **HIP** — `data/gaia/gaia_dr3_hip_xmatch.tsv` on its HIP.
3. **CNS5** — `data/classic-ids/cns5.tsv` on its GJ: the exact
   number-plus-letter key, each letter of a combined `gj_comp` separately,
   and the bare number **only from a row CNS5 lists without letters**. A
   binding takes one component's source, so a bare cell may not fold onto a
   lettered row — GJ 1001 is the shape, where CNS5 lists the L-dwarf pair C
   first ([The GJ fold stops at the component](../../classic-ids/README.md#the-gj-fold-stops-at-the-component)).
   The `gl:` ↔ `gl:` bridges of `data/sid/sameas-overrides.tsv` are read as
   one designation, so CNS5's `GJ 9140` row answers for `Gl 157.1`.
4. **SIMBAD** — the Gaia source SIMBAD's frozen cross-IDs
   (`data/simbad/simbad_sptype.tsv`) hold under the record's HIP, then TYC,
   then GJ (exact, with its bridged spellings, before bare). A key two SIMBAD
   objects claim proposes nothing, counting an object SIMBAD holds with no
   Gaia id: it proposes no source but still contests the key, so 44 Boo's
   system object (`GJ 575`) keeps the bare number from reaching `575 B`. The bare GJ key is what lets a lettered
   cell reach an unresolved pair's one object — the pull keeps a single GJ
   ident per object, so EZ Aqr sits under `866 C` whatever letter the record
   names — and the two-claimants guard is what stops a resolved pair's
   components answering for each other.

A value two sources agree on outranks a lone leader; ties fall in the order
above.

## Both gates weigh every candidate

**Every** candidate goes through **both binding gates by calling
`weighBinding`** (`binding-gate-pure.ts`) — the one call
`applyBindingGate` makes on the label side, so the two cannot drift on what
counts as a bad binding — and the first that binds wins. The verdict carries
each arm separately: the magnitude arm's outcome (`consistent`, `rejected`, or
why it could not weigh — `no_printed_v` / `no_pulled_row` / `null_g`) and
whether the sibling arm, which needs neither a G nor a V, refused. A candidate
binds unless one arm refused it, and the coverage counts read the magnitude
outcome whatever the sibling arm said, so a refusal never hides a gap in the
pull. The magnitude gate weighs G
against the record's **printed V in the V cascade's own tier order**:
Hipparcos on its HIP, else Tycho-2's `VT − 0.090(BT − VT)` on its TYC, else
Gliese's `Vmag` on its GJ cell — all three through `printedV` over the
evidence's `printedVLookups`, the one walk and bundle both gates read them by
([The V cascade](../../photometry/README.md#the-v-cascade)).
The Tycho-2 arm is what reaches
the HD-only rows: a best-neighbour walk landing on a faint neighbour of a
Tycho star has no HIP to be caught by, and 32 fills sat more than a magnitude
below their own star's Tycho-2 V — 14 of them by two to nine magnitudes. The
gates refuse <!-- count:membership-manifest/membership.binding.gate-mag -->220<!-- /count --> candidates on G − V and <!-- count:membership-manifest/membership.binding.gate-sibling -->81<!-- /count --> on sibling-letter attribution
(`binding.gate-mag`, `binding.gate-sibling`; an addition's refusals are
`addition-binding.*`); falling off the end is a derived refusal.
`binding.ungateable` (<!-- count:membership-manifest/membership.binding.ungateable -->7<!-- /count -->) is the rows that reached a candidate with no printed V
under any tier, so only the sibling arm weighs its candidates — the same
`unweighable: 'no_printed_v'` the overlay gate reaches.

**A component designation rescues a row the sibling gate leaves unbound.**
Where SIMBAD puts the row's HIP on both components, the gate reads the row as
the system and refuses any source but the primary's. When that leaves the row
with **no** passing candidate, a refused candidate SIMBAD
indexes the row's own TYC under — and no other source under it
(`RowGateEvidence.tycWitness`, read off the SIMBAD route's own index and its two-claimants rule) —
binds after all: Tycho-2 resolved the pair, so the row is that component
carrying the pair's shared HIP. 53 Aqr B (HD 212697 · TYC 6385-683-1 on
HIP 110778) and μ Dra B (HD 154905 · GJ 9584B on HIP 83608) are the shape —
AT-HYG merged B's cells onto the system's HIP, and the refusal left B's own
source to come back through the magnitude term as an unnamed twin. VV Crv
(HIP 61910) is the third.

<a id="a-hip-on-neither-component-is-the-systems"></a>**A HIP on neither component is the system's, and no witness overrides it.**
HIP 62686 and HIP 52774 carry only a HIP and a TYC SIMBAD files under B; their
Hipparcos entry lives on SIMBAD's system object, and `multiples.tsv` anchors
component A on it. Rescued, the row sat on B's source and companion promotion
minted a synthetic B beside it — one star drawn twice. 30 rows are that shape;
they stay refused and count under `admit.magnitude.refused-sibling`. Where the
row's own TYC is A's, the HIP binds A: HIP 40476 sits on SIMBAD's `HD 69445`,
which carries no Gaia id, while TYC 7122-1231-1, Gaia's HIP and TYC
cross-matches and SIMBAD's object for the bound source all name HD 69445 A,
and B (TYC 7122-1231-2) is a record of its own. The four-witness close-pair
rule ([Which witness decides a close pair's HD](../../simbad/README.md#which-witness-decides-a-close-pairs-hd))
reads the same: no witness names B. A component that carries the system's HIP
anyway is the binaries pipeline's to refuse, not this derivation's.

**It never outranks a candidate that passes on its own.** A TYC alone is not a
component attribution: SIMBAD files HR 846's TYC 3700-1745-1 under HD 17743 C
while its HIP, HD and HR name the unresolved AB, and letting the TYC win
re-bound 32 such rows onto a companion. A HIP SIMBAD gives to the other
component alone still refuses. The overlay gate weighs each source alone, with
no rival to defer to, so it applies no rescue.

## Identity outranks a blended magnitude

**A refused source that SIMBAD and the HIP's own position both name is the
HIP's star, and binds.** The magnitude gate holds Gaia's G against the
record's printed V, and on a Hipparcos double that V is the blend's: θ¹ Ori A
(HIP 26220) prints V 4.98 against G 6.63 for the source SIMBAD's
`* tet01 Ori A` carries, and the gate refuses it. A refused source is
unshipped, so the magnitude term admitted it as an unnamed second record of
the same star. Two witnesses independent of the photometry now outrank the
gate: SIMBAD's **one** object for the row's HIP carries the source (two
objects on the HIP name nothing, as on the SIMBAD route), and Gaia's position
carried back to J1991.25 lands on HIP2's within the Hipparcos tolerance
([A source against its HIP](../positional-witness/README.md#a-source-against-its-hip)).
The binding ships `binding.identified.<lead>`; `binding.identity-witness`
(`addition-binding.*` on an addition) records the source, the separation, and
the source's G beside the row's printed V that the magnitude gate refused on,
either way. Like the component witness it applies only once every candidate
has refused, so it never outranks a candidate that passes on its own.

**Where the position does not confirm SIMBAD, the row ships no source, and
it is queued** (`unconfirmed`, below) **only where the refused source is a
magnitude-term row** — the one case that draws a star twice. Its queue row's
derived source is empty, so it carries the named source, that source's G and
its separation in `identity_*` cells. The source stays
that row while it waits: a disagreement leans toward a different star —
HIP 83369's source sits 64″ from the HIP — and withholding it could drop a
real one. A refused source fainter than the floor draws nothing twice, so its
row is an ordinary refusal and only `*.identity-witness` records what SIMBAD
named. No position is no confirmation: the HIPs the original Hipparcos
catalogue lists as the second member of a double with no astrometric solution
of their own have no HIP2 row.

**The losers are weighed too, not only the candidates ahead of the winner.**
`passingRunnersUp` reads the rejections to decide whether a row's sources
genuinely disagree, so a candidate left unweighed would read as passing on a
verdict never taken and queue a `contested` review the gate settles by itself.
Gl 864 is the shape: its runner-up was the TYC walk's neighbour at G 13.90
against the star's printed V 9.98, which the magnitude gate already refuses.

## What the derivation cannot settle alone

Three outcomes are queued into `data/membership/binding-review.tsv`: the two
below, and an `unconfirmed` identity witness
([Identity outranks a blended magnitude](#identity-outranks-a-blended-magnitude)).
An addition group queues on the same terms when it is contested or
unconfirmed; it cannot collide, since admission leaves a shared source on
neither group.

A **contested** row is one whose winner has a runner-up the gates also passed:
the precedence order chose, not the evidence. It **ships the winner** and
queues for review rather than withholding — 227 such rows shipped under the
frozen column because the cell corroborated the winner, and withholding them
once the cell went would have dropped 227 bindings to express less confidence
than the derivation has. A disposition may still name a different value —
Gl 563.2 A is the shape: the CNS5 route reads the spine's own `gl` cell, so
AT-HYG's swapped letter sends it to CNS5's A row, which is the OTHER
component's source, while SIMBAD binds the star the HIP names. CNS5 itself
letters the two the way SIMBAD and the HIP do.

A **collision** is one source two spine rows derive: a Gaia source on two
records keys neither ([§ 4.1](/docs/sid.md#41-same-as-equivalence-graph)), so **both** are withheld and
queued. Nothing in the derivation ranks one row over the other, so there is no
tiebreak to inherit, and inventing one would settle an identity question on
walk order.

## A disposition is the authority wherever one keys a row

Whatever the derivation reached, a row of
`data/membership/binding-review-dispositions.tsv` settles it — keyed on
the record's `tyc` / `hip` / `hd` / `gl` cells and restating the derived id it
was taken over, so a re-pull that moves the derivation re-opens the review
rather than carrying a stale verdict forward. `keep_source_id` is what the row
ships: the derived id, any other candidate the queue row lists, an id **no
committed source proposes at all**, or empty for none. The third case is <!-- count:membership-manifest/membership.disposition.asserted -->31<!-- /count -->
today (`disposition.asserted`) and is why the file exists — the review
reached evidence the derivation cannot, and the count is what keeps the number
of ids resting on it visible.

**An asserted id still needs a second witness**, because the count cannot
supply one: a mistyped digit leaves every `disposition.*` code reading what it
read before, so nothing but the value itself says it is wrong. The generator therefore requires every asserted
id to be a source `data/gaia/gaia_dr3_astrometry.tsv` carries, and
fails the build otherwise, on every basis. A DR2-namespace id therefore never
ships: where DR3 has a successor the disposition keeps it, and where DR3 splits
the DR2 source into a pair the unresolved record ships none — GJ 3775 and
GJ 3981, whose DR3 components SIMBAD files under objects that carry no
parallax, proper motion or radial velocity, while the record's GJ name still
reaches the system object that does.

`basis` comes from a closed enum: `tycho2_position` (the record's own Tycho-2
position against the source), `v70a_astrometry` (V/70A's B1950 position and
proper motion against it), `simbad_dr2_object` (SIMBAD's object for the
record's Gaia DR2 id names the record and carries its DR3 renumbering), `gaia_photometry` (G against the record's printed V on each
candidate), `pair_component` (a pair's components: which one the record is,
the HIP and SIMBAD's letters deciding, or none where the record is the system
Gaia resolves), `shared_source` (one source two records
reach, held by the one whose light it is), `tycho2_photometry` (of a Tycho-2
pair's entries, the one whose `VT` is nearest the HIP's printed V; the
pair-review dispositions use it, and the build recomputes it,
[Disposing a queued pair](../merge-derivation/README.md#disposing-a-queued-pair)). Each disposition's code says what it kept and whether the derivation
had queued the row: `disposition.<derived|other|none>.<queued|settled>`. Today
9 keep the derived id, 42 another and 3 none. The nine
are the four DR2 ids SIMBAD carries a DR3 successor for, HD 2094 (the HIP
record follows its canonical key onto the primary), Gl 225.2 A, HD 199461
(SIMBAD names the brighter of a blended pair whose fainter member the TYC
cross-match picks), and GJ 1001 and GJ 3527 — bare cells the SIMBAD route
binds to component A only while `simbad_sptype.tsv` holds no companion
object under the number, so the review stays the authority should a pull
bring one back. A kept value ships as `reviewed`.

## The candidates have to be in the astrometry pull

A missing G is a pass at
the gate, so `derivationCandidateSourceIds` feeds every source any row could be
bound to into `../../astrometry-request/`, and a candidate weighed with no
pulled row — the request under-covering the derivation — fails the build: each
derivation hands its `unweighedNoPulledRow` to membership lineage as a
`binding.unweighed-no-pulled-row` row, one per record and source, citing the
addition items whose own derivation weighed it, and `MEMBERSHIP_INVARIANTS`
forbids the code ([Invariants](../../lineage/README.md#invariants)). `binding.weighed-null-g` (<!-- count:membership-manifest/membership.binding.weighed-null-g -->77<!-- /count -->) is a candidate on a row Gaia
publishes no G for, which no request can supply.

## A Gaia id for a bright star is an identity statement, not a data source

Most of the fills are saturated stars whose source is a 2-parameter solution:
sky position only, no parallax, no proper motion. Such a source satisfies
neither the direction cascade (5p) nor the distance cascade (a parallax), and
`GAIA_PHOTOMETRY_SATURATION_G` refuses the
[Riello 2021](/data/papers/index.md#riello2021) V transform below G 4, so
those records keep their Hipparcos-2 astrometry and printed V whatever goes
in the identifier cell. The bright end is protected by evidence-keyed
conditions; an empty cell is the worse way to express one.
