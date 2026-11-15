# Reading a built catalogue

The readers a bake that measures the built catalogue imports, and the
projection it records
([Freshness](../../pipeline/README.md#freshness--one-mechanism)).

## Files

- `catalog-buffer.ts` — `readCatalogBuffer`: the manifest's transport chunks
  read and reassembled into one buffer. `../catalog-lookup.ts`,
  `../validate/record-parity.ts` and the column reader below read through it.
- `catalog-columns.ts` (+ test) — `readCatalogColumns`: float32 record
  columns, each decoded whole (`decodeRecordColumn`), the reader for a bake
  that measures the catalogue (`/scripts/milkyway-calibration/`); and
  `catalogColumnsProjection`, the same columns hashed as that bake's
  `describe`, with `requestFrom` naming the manifest so the bake orders after
  `build:catalog`. The bake passes one field list to both, so what it hashes
  is what it measures.
