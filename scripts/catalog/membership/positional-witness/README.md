# The positional witness

Whether a catalogue position names one of a set of Tycho-2 entries: the
position is brought to the entry's own epoch and equinox, and each entry's
separation from it is tested against the source's tolerance. One helper for
both settling surfaces — the unlinked GJ cells of
`data/membership/merge-divergence.tsv` (`stellata-hooj.17.11.2`) and the
`no_hip_source` HIPs of `data/membership/pair-review.tsv` (the
`stellata-hooj.17.11.5` child). What a verdict leads to — a queue row, a
ledger row, a disposition — is each consumer's call; this folder only
measures.

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

**Hipparcos** (`witnessHipparcos`) — HIP2's position against each entry's
**observed** cell. Both are stated at J1991.25
([Which position to propagate from](/data/tycho2/README.md#which-position-to-propagate-from)), so
nothing is carried. The mean position will not do: both entries of a
`pflag='P'` pair carry the same mean position, the blend's photocentre, and
315 of the <!-- count:membership-manifest/membership.merge.pair.review.no-hip-source -->1,046<!-- /count --> queued pairs are that shape.

**V/70A** (`witnessV70a`) — the GJ cell's B1950 position, carried by its own
total proper motion and position angle from B1950.0 to the entry's epoch in
the B1950 frame, then precessed to J2000 with the IAU 1976 angles
(`/src/astro-core/precession.ts`). The entry's place is its mean position at
J2000, or its observed cell at J1991.25 where it has no mean solution or the
mean solution is a photocentre. The FK4 → FK5 frame terms (the E-terms of
aberration, ≤ 0.34″, and the FK4 equinox offset, ~0.5″) are left out: they
sit under V/70A's own 0.001° (3.6″) printing and inside the 0.7–12.1″ spread
of known matches below, so no verdict turns on them.

## The tolerances

Measured 2026-11-16 over the committed tables. The verdict counts are pinned
in `positional-witness-spread.test.ts`.

**`HIPPARCOS_WITNESS_TOLERANCE_ARCSEC = 0.5`.** Over the <!-- count:membership-manifest/membership.merge.pair.review.no-hip-source -->1,046<!-- /count -->
`no_hip_source` HIPs, HIP2 lands on the nearer entry's observed cell within
0.39″ at the 99th percentile (median 0.02″, worst 1.31″); the other entry sits
a median 2.85″ away and as close as 0.12″. At 0.5″: **1,025 match, 5 none,
16 several**. At 1.0″ the several count rises to 137; at any value the V/70A
witness needs (≥ 12″) it is 1,005, which is why one tolerance cannot serve
both sources.

**`V70A_WITNESS_TOLERANCE_ARCSEC = 15`.** The 22 `v70a_astrometry`
dispositions (`data/membership/binding-review-dispositions.tsv`) put V/70A
0.7–12.1″ from the Gaia source each keeps, apart from two slips in V/70A's
own coordinates: Gl 629.3 at 99.9″ and GJ 1001 at 117.2″, both kept on proper
motion rather than position. Against the merge-divergence ledger's unlinked
GJ cells, the cell's own TYC lands a median 5.3″ away. The separations run
continuously to 13.8″ and then jump to 20.6″, and 15″ sits in that gap,
above every known match. The seven from 20.6″ to 48.7″ are not known either
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
