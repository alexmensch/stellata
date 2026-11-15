# Catalogue build stages

`build:catalog`'s stages, one per phase of the record list, plus the one
emission they feed. `../build-catalog.ts` only wires them: each stage takes
the phase it runs in and hands on the next, so the order lives in the types
([Record phases](../record/README.md#record-phases)), not in a list of calls.

## Files in this area

```
scripts/catalog/stages/
  walk-stage.ts            walkStage: the manifest walk to the walked
                           records, with placement's, brightness-colour's
                           and size's lineage, the parked ledger and the
                           SIMBAD-sourced distances.
  naming-stage.ts          namingStage: walked to named — designation
                           constellations, the naming authority's tiers,
                           and system distance coherence with its lineage.
  promotion-stage.ts       promotionStage: named to promoted — the minted
                           companions, promotion's lines, identity and
                           counts, and the records moved onto an anchor's
                           distance.
  sorted-stage.ts          sortedPasses: every index-keyed pass over the
                           sorted records — figures, geometric binaries,
                           GCVS, CCDM, the eclipsing sweep, pair resolution
                           and the wings, overlaps, component designations,
                           multiplicity statuses and system membership.
  allocation-stage.ts      allocationStage: SID allocation, throwing before
                           anything is staged when it fails
                           (../README.md#sid-allocation).
  finalise-stage.ts        finaliseStage: sorted to finalised — display
                           names, keyed on the allocated SIDs, with naming's
                           lineage.
  catalog-emission.ts      catalogEmission: promotion's lineage, the
                           encoded binary and every CATALOG_OUTPUTS file,
                           family member and check, for emitArtifacts; and
                           startCatalogBuild, the staged-output sweep and
                           the input hashes taken before any stage runs.
  catalog-stage-lineage.ts The lineage stages' shared declaration against
                           membership's upstream.
```

## The phases

Walked, named, promoted and sorted are tags on one record list; finalised
adds each record's SID and display name beside it. The sort is
`sortByApparentV` (`../record/record-order-pure.ts`), called from the wiring
because it is one call. Which pass takes which phase, and the orders that
holds, is [Record phases](../record/README.md#record-phases).

## Heap

Every stage that builds lineage lines builds them in a function of its own
(`walkManifest`, `coherenceLineage`, `namingLineage`), so the lines are
unreachable once it returns. The promotion stage releases its rows and
rewrites the same way and keeps its lines, which the emission writes. And
`preAllocationStages` in `../build-catalog.ts` holds the reference tables
`loadReadStarsInputs` reads, returning only the few the emission needs, so
they are released before SID allocation. Held longer, either runs the build
out of heap (`../../util/heap-budget/README.md`).

## The wiring ratchet

`../build-catalog.test.ts` parses `../build-catalog.ts` and fails on any
loop, `throw` or arithmetic anywhere in it, on any top-level statement but
an import or a function, and on any function statement but a `const`
initialised by a call, `preAllocationStages`' closing `return` and `main`'s
closing `emitArtifacts` call: logic lands in a stage, never in the wiring.
Each handle to a superseded phase (`walked`, `named`, `promoted`) must be
read exactly once, by the stage that supersedes it: the phase tags refuse a
pass given the wrong phase, but only this check refuses an old handle
reused after a later stage has run.

Across `scripts/` and `src/`, outside tests, it also pins each phase's
`enterPhase` call to the one pass that completes that phase and the SIDs'
`allocatedSids` tag to the allocation stage, finding them through the
syntax tree under any import alias; a phase given as anything but a string
literal fails, as does any cast to a phase type outside
`../record/record-phase.ts`.
