# Catalog record — build side

The record layout and its codec are the on-disk contract both the build
and the viewer read, so they live in
[`/src/catalog-format/record/`](/src/catalog-format/record/README.md).
This folder holds the build's own halves of it.

```
scripts/catalog/record/
  gaia-apsis-source.ts (+ test)   GAIA_APSIS with its parse, declared
                                  (../../util/sources/).
  record-phase.ts (+ test)        The phase tag on the build's record list,
                                  `Sorted`, `AllocatedSids` and `Finalised`,
                                  and the tags' constructors (#record-phases).
  record-order-pure.ts (+ test)   `apparentVFromSol` — the key the build sorts
                                  records on — `sortByApparentV`, the sort
                                  that hands on `Sorted` records, and
                                  `assertSolFirst`, throwing unless exactly
                                  one record carries FLAG_IS_SOL and it sorted
                                  to SOL_RECORD_INDEX (record 0, stated in
                                  catalog-pure.ts). Pure.
                                  /src/catalog-format/record/README.md#record-order.
  curated-records.ts (+ test)     CURATED_RECORDS — the curated-records
                                  source (#curated-records).
  search-index-pure.ts (+ test)   buildSearchIndex — one wire entry per
                                  record a user can type an identifier for
                                  (buildSearchEntry owns the wire shape),
                                  with SearchCounts, the snapshot's search
                                  count block. Pure.
  records-stage-pure.ts (+ test)  recordsCounts — RecordsCounts, the
                                  snapshot's records count block, over the
                                  sorted records — and variabilityUnits,
                                  the quantised period and amplitude each
                                  record writes. Pure.
  encode-catalog-pure.ts (+ test) encodeCatalog — the finalised records
                                  (their SIDs and display names) and their
                                  multiplicity statuses to the assembled
                                  catalog.bin buffer: header, name table (the display
                                  names, NAME tiers only), then each record
                                  with its Apsis cells. Throws on a SID,
                                  display-name or status list that does not
                                  pair one-for-one with the records, on NO_SID,
                                  and unless Sol is the one record without
                                  a constellation. Pure.
```

## Record phases

The build's record list carries the phase it has reached, as a compile-time
tag (`Records<P>`, `record-phase.ts`), and each pass whose place in the order
matters takes the phase it runs in, so a pass moved out of its place does
not compile:

| Phase | Entered by | Passes that take it |
| --- | --- | --- |
| `walked` | the manifest walk | `applyDesignationConstellations`, `applyStarNames`, `systemCoherenceVerdicts`, `applySystemCoherence` |
| `named` | the walked passes | `promoteCompanions` |
| `promoted` | promotion | `sortByApparentV` |
| `sorted` | `sortByApparentV` | `buildHipToIndex`, `inferBinaries`, `applyVariability`, `applyDoublesFlag`, `buildCatalogRowIndexMap`, `wingRenderablePrimaries`, `physicalOverlaps`, `multiplicityStatuses`, `buildSystemMembership`, `lentDistanceRecords`, `catalogSidObjects`, `recordsCounts`, `assignDisplayNames` |

Each order it holds, and why:

- **Naming, then promotion** — the anchor-is-the-component refusal reads the
  `bayerComponent` naming writes ([Row identity](../companions/identity/README.md#anchor-is-the-component-refusal)).
- **Coherence, then promotion** — minted members project off already-coherent
  anchors ([System distance coherence](../multiplicity/README.md#system-distance-coherence)).
- **The sort, then every index-keyed pass** — indices are final only after it
  ([Record order](/src/catalog-format/record/README.md#record-order)).
- **The row-index map, then the wings** — the wings take resolved pairs, which
  only the map resolves, and the map takes `Sorted`.
- **Designation constellations, then variability** — GCVS fills `desigCon`
  only where IV/27A left it empty.
- **SID allocation, then display names** — the curated overrides key on SIDs,
  and `assignDisplayNames` takes `AllocatedSids`, which only the allocation
  stage tags (`allocatedSids`).

Passes in one phase are free to run in either order: naming and coherence,
GCVS and CCDM. The `FLAG_BINARY_PRIMARY` writers' order — geometric, CCDM,
eclipsing, renderable wings — is code order within the sorted phase.

`Finalised` is the sorted records with each one's SID and display name, and is
what `encodeCatalog` and `buildSearchIndex` take; a record carries only its
printed name (`printedName`), so no reader can take the one for the other.

`enterPhase` and `allocatedSids` are the tags' only constructors. Each phase
is entered once, by the pass that completes it, the SIDs are tagged once, by
the allocation stage, and `../build-catalog.test.ts` pins those call sites;
tests call both to build fixtures.

## Curated records

A record no source table states — Sol, today — is one `CuratedRecord`: its
placement, V, direction solution and spectral type, each the value one
cascade's `curated` tier answers with. `CURATED_RECORDS` maps a manifest row
to its record on `ManifestRecord.isSol`, the one owner of that identity;
`loadReadStarsInputs` hands it to `readStars` as `curatedRecords`, and the
walk passes each field to its cascade (`../parse/README.md#per-row-pipeline`).
No cascade knows which record it is curating.

Each curated tier keeps its place in its cascade: the bottom of parallax, V
and direction, so a source table that starts reaching the record wins over
the curation there; the top of spectral class, where a curation exists to
overrule SIMBAD ([The resolver](../spectral/README.md#the-resolver)).

**The placement is the origin**, `OriginPlacement` from the parallax cascade:
distance zero, so no parallax and no distance modulus. A record whose parallax
resolves `curated` is therefore at rest, keeps the absolute magnitude its
placement states, runs no proper-motion rescue and has no positional
constellation — the walk reads all four off that one result rather than off
the record's identity.
