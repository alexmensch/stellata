# Astrometry sources — row schemas and their reads

The Gaia DR3 astrometry, HIP2 and Gaia NSS tables, each as one module: the
row type, the parse, and the declared input
([Declaring a source](../../util/sources/README.md#declaring-a-source)). The
cascades that decide what to do with a row live with their topic —
direction and velocity in `../distance/`, the anchor grade in
`../multiplicity/` — and import the row from here.

## Files in this area

```
scripts/catalog/sources/
  gaia-astrometry-source.ts       GAIA_ASTROMETRY and GaiaAstrometryCatalogRow,
    (+ test)                      the one Gaia DR3 astrometry row fold: the
                                  catalogue table reads it whole
                                  (parseGaiaAstrometryCatalogTsv), and the
                                  magnitude term streams its pull through it
                                  with a keep-set (gaiaAstrometryAccumulator,
                                  `../parse/README.md#streaming-a-committed-table`).
  hip2-source.ts (+ test)         HIP2 and Hip2AstrometryRow. The parse also
                                  lists every HIP the table publishes,
                                  positioned or not, for
                                  ../spine/primaries-tables.ts.
  gaia-nss-source.ts (+ test)     GAIA_NSS, a column table
                                  (../../util/tsv/README.md#reading-a-table),
                                  and parseNssIndex: the source_ids carrying
                                  an NSS two-body orbit, the only signal the
                                  catalogue reads.
  gaia-astrometry-fixture.ts      Test-only GaiaAstrometryCatalogRow builder.
                                  A module, not an export from a test file:
                                  suites in distance/, multiplicity/, parse/
                                  and companions/ build these rows, and a
                                  column added to the interface lands here
                                  once.
```
