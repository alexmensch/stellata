# Reading a built catalogue

The two Node readers of a built catalogue's bytes, and the projection a bake
that measures the catalogue records
([Freshness](../../pipeline/README.md#freshness--one-mechanism)).

**Nothing but code lives in this folder.** A TypeScript step's inputs
include every non-code file beside a module it imports
(`closureWithSiblings`, [util/README.md](../../util/README.md)), so a count
snapshot or data file placed here becomes an input of every bake that reads
the catalogue, and a rebuild that re-pins it stales them all. That is why
these modules sit apart from `../build-catalog-expected.json`.

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
