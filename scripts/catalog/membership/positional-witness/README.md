# The positional witness

Whether a catalogue position names one of a set of Tycho-2 entries: the
position is brought to the entry's own epoch and equinox, and each entry's
separation from it is tested against the source's tolerance. One helper for
both settling surfaces — the unlinked GJ cells of
`data/membership/merge-divergence.tsv`, which the merge derivation settles
with it, and the pair rule, whose second step it is where Gaia cross-matches a
HIP to no source
([Connected is not unique](../merge-derivation/README.md#connected-is-not-unique--the-pair-rule))
— and, through the same Hipparcos tolerance, whether a HIP's position names
one Gaia source: the binding derivation's identity witness
([A source against its HIP](#a-source-against-its-hip)) — and which HIPs
lie within an arcsecond of a Gaia position, the binding derivation's position
witness ([A HIP against the floor's sources](#a-hip-against-the-floors-sources)).
What a verdict leads to — a move, a queue row, a ledger row, a disposition —
is each consumer's call; this folder only measures.

## Files in this area

```
scripts/catalog/membership/positional-witness/
  positional-witness-pure.ts      witnessV70a and witnessHipparcos, the two
    (+ test)                      tolerances, the WitnessVerdict union, and
                                  hipparcosSeparationFromSource for one Gaia
                                  source, and hipsNear, the HIPs within
                                  HIPPARCOS_FORWARD_TOLERANCE_ARCSEC of a
                                  position. Pure.
  positional-witness-spread.test.ts
                                  The verdict counts and gaps below,
                                  recomputed over the corrected spine's
                                  pairs whose HIP Gaia cross-matches to no
                                  source and its unlinked GJ cells, and
                                  pinned. LFS-gated.
```

## The verdict

`match` (exactly one entry inside the tolerance), `none` (no entry inside)
or `several` (more than one). Every verdict carries every candidate's
separation, nearest first, so a consumer can cite the evidence without
measuring again. **A close pair inside the tolerance is `several`, never a
match**: the tolerance cannot tell two entries apart that sit closer together
than the source's own precision, and the verdict says so instead of picking
the nearer.

## The two witnesses

**Hipparcos** (`witnessHipparcos`) — HIP2's J1991.25 position, carried by
its own proper motion to each entry's **observed** cell: its RA to the epoch
the cell's RA was measured at and its Dec to the Dec's, which differ per row
on the main table and are J1991.25 on the supplement
([Which position to propagate from](/data/tycho2/README.md#which-position-to-propagate-from)).
The mean position will not do: both entries of a `pflag='P'` pair carry the
same mean position, the blend's photocentre, and 315 of the 1,046 spine pairs
whose HIP Gaia cross-matches to no source are that shape. A HIP with no HIP2
proper motion cannot be witnessed (`hipparcosAstrometry` returns null); none of
those 1,046 lacks one.

**V/70A** (`witnessV70a`) — the GJ cell's B1950 position, carried by its own
total proper motion and position angle from B1950.0 to the entry's epoch in
the B1950 frame, then precessed to J2000 with the IAU 1976 angles
(`/src/astro-core/precession.ts`). The entry's place is its mean position at
J2000, or its observed cell at that cell's own epochs where it has no mean
solution or the mean solution is a photocentre. The FK4 → FK5 frame terms (the E-terms of
aberration, ≤ 0.34″, and the FK4 equinox offset, ~0.5″) are left out: they
sit under V/70A's own 0.001° (3.6″) printing and inside the 0.7–12.1″ spread
of known matches below, so no verdict turns on them.

## The tolerances

Measured 2026-11-16 over the committed tables. The verdict counts are pinned
in `positional-witness-spread.test.ts`.

**`HIPPARCOS_WITNESS_TOLERANCE_ARCSEC = 0.4`.** Over those 1,046
HIPs, carried HIP2 lands on the nearer entry's observed cell
within 0.18″ at the 99th percentile (median 0.013″); the nearer separations
run continuously to 0.36″, then two pairs Hipparcos measured as one sit at
1.05″ (HIP 17750) and 1.23″ (HIP 94223). Uncarried, the 99th percentile was
0.39″ and every one of the five fast movers past 0.5″ read `none`. The other
entry sits a median 2.81″ away and as close as 0.12″. 0.4″ is the tightest
value above every right entry but the two blends: **1,034 match, 2 none
(those two), 10 several** — close pairs whose other entry is inside it too.
At 0.3″ HIP 30953's right entry (0.36″) would read `none`; at 0.5″ six more
pairs read `several`, at 1.0″ 141 do, and at the V/70A witness's 15″ 1,024
do, which is why one tolerance cannot serve both sources.

**`V70A_WITNESS_TOLERANCE_ARCSEC = 15`.** The 22 `v70a_astrometry`
dispositions (`data/membership/binding-review-dispositions.tsv`) put V/70A
0.7–12.1″ from the Gaia source each keeps, apart from two slips in V/70A's
own coordinates: Gl 629.3 at 99.9″ and GJ 1001 at 117.2″, both kept on proper
motion rather than position. Over the 130 unlinked GJ cells of the corrected
spine — each spine GJ against its row's own TYC — the separations run
continuously to 13.5″ and then jump to 20.7″, and 15″ sits in that gap,
above every known match: **100 match, 29 none**, and one GJ has no V/70A
astrometry. The `none` ones from 20.7″ to about 50″ are not known either way
and go to review with their separations; beyond them the separations run
past 600″. `positional-witness-spread.test.ts` rebuilds that population
and pins all of it.

The merge derivation runs the witness on every unlinked GJ the record still
ships ([Settling an unlinked cell](../merge-derivation/README.md#settling-an-unlinked-cell)),
so its `membership.merge.unlinked.gl.*` counts cover fewer cells: the
label merge has already relabelled some of the 130.

What 15″ cannot separate: a neighbouring Tycho-2 entry inside it. Gl 369's
V/70A place is 0.7″ from TYC 5483-418-1 and 410″ from the TYC its row carries;
GJ 421 A's sits 5.4″ and 13.8″ from the two entries of the pair, so the
witness returns `several`.

## A source against its HIP

`hipparcosSeparationFromSource` asks the reverse question of one Gaia source:
**the source is carried back** to J1991.25 by Gaia's own proper motion and
held against HIP2's position there, under the same
`HIPPARCOS_WITNESS_TOLERANCE_ARCSEC`. The direction is the point. The stars
this serves are Hipparcos doubles — the binding derivation's identity witness
([Identity outranks a blended magnitude](../binding/README.md#identity-outranks-a-blended-magnitude))
— whose HIP2 position at its own epoch is sound while its proper motion
carries the companion: θ¹ Ori A's reads 58.9 ± 32.7 mas/yr against Gaia's
1.4. Measured 2026-11-16 over the 20 such HIPs with a HIP2 position, the
source carried back lands within 0.22″ on 18 (median 0.03″); HIP2 carried
forward misses eight of the same 18 by 0.75–2.8″. The two the tolerance
refuses sit 1.37″ (HIP 39827) and 64″ (HIP 83369) away. A source Gaia
publishes no proper motion for cannot be carried, so it is never named.

## A HIP against the floor's sources

`hipsNear` asks the forward question over many positions at once: **HIP2
carried forward** to the Gaia position's epoch by its own proper motion, and
every HIP within `HIPPARCOS_FORWARD_TOLERANCE_ARCSEC = 1` of it, nearest
first. A grid over unit vectors one tolerance wide answers each position from
its own cell and the 26 around it, so the RA wrap and the poles need no case
of their own. The magnitude term streams its kept rows through it
([The position witness](../binding/README.md#the-position-witness)).

The direction is the reverse of the identity witness's, and has to be: the
sources it serves are mostly saturated 2-parameter solutions with no proper
motion to carry them back by — 160 of the 284 Gaia-only sources within 1″ of
an unbound HIP, measured 2026-11-18. Over the 465 primaries HIP rows that bind
nothing, carried HIP2 lands within 1″ of a magnitude-term source on 211: 202
under 0.5″, 9 at 0.5–1″, then only 10 more out to 10″. 1″ sits in that gap.
