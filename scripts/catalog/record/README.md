# Catalog record — build side

The record layout and its codec are the on-disk contract both the build
and the viewer read, so they live in
[`/src/catalog-format/record/`](/src/catalog-format/record/README.md).
This folder holds the build's own halves of it.

```
scripts/catalog/record/
  gaia-apsis-source.ts (+ test)   GAIA_APSIS with its parse, declared
                                  (../../util/sources/).
  record-build-pure.ts (+ test)   Record logic only the build runs: the
                                  SIMBAD namespace ladder both SIMBAD pulls
                                  index and join through
                                  (/scripts/catalog/spectral/README.md#the-ladder-is-ordered-by-what-an-identifier-names),
                                  GCVS parsing and variability
                                  classification, geometric binary and CCDM
                                  optical-double inference, and the
                                  apparent ↔ absolute magnitude conversions.
                                  Pure.
  record-order-pure.ts            `apparentVFromSol` — the key the build sorts
                                  records on. Pure.
                                  /src/catalog-format/record/README.md#record-order.
```
