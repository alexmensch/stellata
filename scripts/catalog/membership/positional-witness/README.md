# The positional witness

Whether a catalogue position names one of a set of Tycho-2 entries: the
position is brought to the entry's own epoch and equinox, and each entry's
separation from it is tested against the source's tolerance. One helper for
both settling surfaces — the unlinked GJ cells of
`data/membership/merge-divergence.tsv` (`stellata-hooj.17.11.2`) and the pair
rule, whose second step it is where Gaia cross-matches a HIP to no source
([Connected is not unique](../merge-derivation/README.md#connected-is-not-unique--the-pair-rule)).
What a verdict leads to — a move, a queue row, a ledger row, a disposition —
is each consumer's call; this folder only measures.

## Files in this area

```
scripts/catalog/membership/positional-witness/
  positional-witness-pure.ts      witnessV70a and witnessHipparcos, the two
    (+ test)                      tolerances, and the WitnessVerdict union.
                                  Pure.
  positional-witness-spread.test.ts
                                  The verdict counts below, recomputed over
                                  the committed queues and pinned.
                                  LFS-gated.
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
same mean position, the blend's photocentre, and 315 of the <!-- count:membership-manifest/membership.merge.pair.review.no-hip-source -->1,046<!-- /count --> queued
pairs are that shape. A HIP with no HIP2 proper motion cannot be witnessed
(`hipparcosAstrometry` returns null); none of the queued ones lacks one.

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

**`HIPPARCOS_WITNESS_TOLERANCE_ARCSEC = 0.4`.** Over the <!-- count:membership-manifest/membership.merge.pair.review.no-hip-source -->1,046<!-- /count -->
`no_hip_source` HIPs, carried HIP2 lands on the nearer entry's observed cell
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
motion rather than position. Against the merge-divergence ledger's unlinked
GJ cells, the cell's own TYC lands a median 5.3″ away. The separations run
continuously to 13.8″ and then jump to 20.7″, and 15″ sits in that gap,
above every known match. The seven from 20.7″ to 48.7″ are not known either
way — Gl 533.1, GJ 421 B, GJ 4327, GJ 1100, GJ 1141 A, GJ 9350, GJ 1141 B,
three of them members of a close pair — and come back `none` with their
separations for the consumer's review; beyond them the separations run
51–652″. On the 132 unlinked GJ cells with a TYC, tested
against that TYC alone: **84 match, 25 none**, and 23 cells have no V/70A
astrometry to test (mostly `GJ 9xxx` numbers V/70A does not carry).

What 15″ cannot separate: a neighbouring Tycho-2 entry inside it. Gl 369's
V/70A place is 0.7″ from TYC 5483-418-1 and 410″ from the TYC its row carries;
GJ 421 A's sits 5.4″ and 13.8″ from the two entries of the pair, so the
witness returns `several`.
