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

Counted `physicalOverlaps` (<!-- count:build-catalog/physicalOverlaps -->55<!-- /count -->), a ratchet-down metric; the
build log names each pair.
