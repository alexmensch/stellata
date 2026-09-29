# The binding derivation

A spine row's `gaia_source_id`, derived from committed evidence alone. The
manifest that consumes it is `../README.md`; the retirement this derivation
completes is [§ 3.2](/docs/catalog-driver.md#32-retiring-the-spines-consumers--per-column-per-consumer-in-order).

## Files in this area

```
scripts/catalog/membership/binding/
  binding-derivation-pure.ts    The four candidate sources, the consensus
    (+ test)                    ranking, both gates through
                                resolveGaiaSourceId, and the candidate set the
                                astrometry request has to cover. Pure, and
                                imports nothing from the manifest —
                                `../../spine/` and
                                `../../astrometry-request/` read it too.
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
   objects claim proposes nothing. The bare GJ key is what lets a lettered
   cell reach an unresolved pair's one object — the pull keeps a single GJ
   ident per object, so EZ Aqr sits under `866 C` whatever letter the record
   names — and the two-claimants guard is what stops a resolved pair's
   components answering for each other.

A value two sources agree on outranks a lone leader; ties fall in the order
above.

## Both gates weigh every candidate

**Every** candidate goes through **both binding gates by calling
`resolveGaiaSourceId`** — the one call `applyBindingGate` makes on the label
side, so the two cannot drift on what counts as a bad binding — and the first
that passes wins. The magnitude gate weighs G
against the record's **printed V in the V cascade's own tier order**:
Hipparcos on its HIP, else Tycho-2's `VT − 0.090(BT − VT)` on its TYC, else
Gliese's `Vmag` on its GJ cell — the last two through `printedVLookups`, the
one bundle both gates read them by ([The V cascade](../../photometry/README.md#the-v-cascade)).
The Tycho-2 arm is what reaches
the HD-only rows: a best-neighbour walk landing on a faint neighbour of a
Tycho star has no HIP to be caught by, and 32 fills sat more than a magnitude
below their own star's Tycho-2 V — 14 of them by two to nine magnitudes. The
gates refuse 317 candidates on G − V and 119 on sibling-letter attribution
(`derivedRejected`); falling off the end is a derived refusal.
`derivedUngateable` (7) is the rows that reached a candidate with no printed V
under any tier, so nothing could be weighed against it.

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

**A HIP on neither component is the system's, and no witness overrides it.**
HIP 62686 and HIP 52774 carry only a HIP and a TYC SIMBAD files under B; their
Hipparcos entry lives on SIMBAD's system object, and `multiples.tsv` anchors
component A on it. Rescued, the row sat on B's source and companion promotion
minted a synthetic B beside it — one star drawn twice. 30 rows are that shape;
they stay refused and count under `magnitudeRowsOwnCandidate.refused_sibling`.

**It never outranks a candidate that passes on its own.** A TYC alone is not a
component attribution: SIMBAD files HR 846's TYC 3700-1745-1 under HD 17743 C
while its HIP, HD and HR name the unresolved AB, and letting the TYC win
re-bound 32 such rows onto a companion. A HIP SIMBAD gives to the other
component alone still refuses. The overlay gate weighs each source alone, with
no rival to defer to, so it applies no rescue.

**The losers are weighed too, not only the candidates ahead of the winner.**
`passingRunnersUp` reads the rejections to decide whether a row's sources
genuinely disagree, so a candidate left unweighed would read as passing on a
verdict never taken and queue a `contested` review the gate settles by itself.
Gl 864 is the shape: its runner-up was the TYC walk's neighbour at G 13.90
against the star's printed V 9.98, which the magnitude gate already refuses.

## What the derivation cannot settle alone

Two outcomes are queued into `data/membership/binding-review.tsv`.

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

## The candidates have to be in the astrometry pull

A missing G is a pass at
the gate, so `derivationCandidateSourceIds` feeds every source any row could be
bound to into `../../astrometry-request/` and `derivedWeighedNoGMag` is pinned at
**0** — a candidate weighed with no pulled row is the request under-covering
the derivation. `derivedWeighedNullGMag` (77) is Gaia publishing no G for a
source it has a row for, which no request can supply.

## A Gaia id for a bright star is an identity statement, not a data source

Most of the fills are saturated stars whose source is a 2-parameter solution:
sky position only, no parallax, no proper motion. Such a source satisfies
neither the direction cascade (5p) nor the distance cascade (a parallax), and
`GAIA_PHOTOMETRY_SATURATION_G` refuses the
[Riello 2021](/data/papers/index.md#riello2021) V transform below G 4, so
those records keep their Hipparcos-2 astrometry and printed V whatever goes
in the identifier cell. The bright end is protected by evidence-keyed
conditions; an empty cell is the worse way to express one.
