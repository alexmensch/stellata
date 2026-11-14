# Catalog record — build side

The record layout and its codec are the on-disk contract both the build
and the viewer read, so they live in
[`/src/catalog-format/record/`](/src/catalog-format/record/README.md).
This folder holds the build's own halves of it.

```
scripts/catalog/record/
  gaia-apsis-source.ts (+ test)   GAIA_APSIS with its parse, declared
                                  (../../util/sources/).
  record-order-pure.ts (+ test)   `apparentVFromSol` — the key the build sorts
                                  records on — and `assertSolFirst`, throwing
                                  unless exactly one record carries
                                  FLAG_IS_SOL and it sorted to
                                  SOL_RECORD_INDEX (record 0, stated in
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
  encode-catalog-pure.ts (+ test) encodeCatalog — the sorted records, their
                                  SIDs and multiplicity statuses to the
                                  assembled catalog.bin buffer: header, name
                                  table (the NAME tiers only), then each
                                  record with its Apsis cells. Throws unless
                                  Sol is the one record without a
                                  constellation. Pure.
```

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
