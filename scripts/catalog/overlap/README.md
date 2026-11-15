# Overlap gate

Which records `catalog.bin` draws inside one another, across the whole
catalogue — whatever placement rule put them there.

## Files in this area

```
scripts/catalog/overlap/
  overlap-gate-pure.ts (+ test)   physicalOverlaps: record pairs closer than
                                  the sum of their radii, less those an orbit
                                  chain separates; orbitChainExemption, the
                                  exemption; overlapLabel, a record's name
                                  in the build log.
  overlap-lineage-pure.ts         OVERLAP_CODES, overlapLineageLines and
    (+ test)                      OVERLAP_INVARIANTS: each overlapping pair
                                  as the overlap lineage stage
                                  (#overlap-lineage).
```

## Overlap gate

After the record sort, build-catalog counts every pair of records whose
centres sit closer than the sum of their physical radii — a star drawn inside
another — at the 32-bit positions `catalog.bin` ships, where two records the
build keeps 1 AU apart at 1 kpc collapse onto one point.

A pair is exempt only when a chain of renderable orbits fixes their relative
position — one record an ancestor of the other along (primary, secondary)
relations — since the runtime then draws them apart from the elements, and a
bit-identical bake there is the deliberate sub-resolution placement
([Promotion placement](../companions/placement/README.md)). Two siblings of
one primary are not exempt: each moves on its own orbit, and nothing keeps
them apart. The relations come from the runtime's own pairing —
`renderableOrbitRelations` in `../companions/record-index/`, the `rendered`
ends of `resolvePairs` (the resolution the writer takes) filtered to
renderable orbits — never from promotion's cursor walk, which records a pair
before its parent is minted.

Each pair is an `overlap.inside` row
(<!-- count:build-catalog/overlap.inside -->55<!-- /count -->), and the build log names each pair.

## Overlap lineage

`build:catalog` writes each overlapping pair as the `overlap` lineage stage,
after promotion in `LINEAGE_STAGES`
([Record lineage](../lineage/README.md#the-overlap-stage)), from
`overlap-lineage-pure.ts`. A record not drawn inside another has no row: a
pair is a fact about two records, not a decision about every one, as a
`pairs` row is about a pair. The row is keyed on the origin key first in
byte order, the other record's in `params.other`, so a pair keeps its row
however the records sort. Its count is the snapshot's `overlap` stage.

`OVERLAP_INVARIANTS` allows an `overlap.inside` row only for the pairs it
names, each by key and params together, since one record can overlap
several ([Invariants](../lineage/README.md#invariants)): a new pair fails the
build by name, even against a listed record, and a pair a fix separates
fails until it is struck off the list.

`OVERLAP_LINEAGE_BUDGET` pins 2 kB and 1 s: 55 rows came to 878 bytes gzipped
in 68 ms, not diffing against a baseline (2026-11-15).
