# Full-catalog astrometry request

The source_id list the Gaia 5p pull is made against. `pnpm run
build:astrometry-request` emits `data/gaia/gaia_catalog_source_id_request.tsv`
— the deduped, numerically-sorted `gaia_source_id` column of `../spine/`.
Not a network pull and not on the `build:catalog` path: this is
**input preparation** for `scripts/refresh/`, which is why it sits beside
the record build rather than inside it (`../README.md` owns the output
contract).

## Files in this area

```
scripts/catalog/astrometry-request/
  export-astrometry-request.ts    The generator. Streams the spine through
                                  iterSpineTsv, collects non-empty
                                  gaia_source_id, sorts, writes.
  export-astrometry-request-pure.ts
    (+ test)                      sortSourceIdsNumeric — the BigInt sort.
                                  Also imported by ../classic-ids/ and
                                  scripts/sid/export-dr-risk-set.ts, so it
                                  is a shared source_id helper rather than
                                  this script's private half.
```

**source_ids exceed 2^53.** A lexicographic sort misorders unequal-length
ids and a `Number` sort collides them, so `BigInt` is the only correct
comparator — and it is what matches the ordering
`write_astrometry_request` gives the binaries-scope request file.

## Request and record build name the same set by construction

**311,886 source_ids** over 313,257 spine rows; the 1,371 rows carrying
none are the no-Gaia tier.

Reading the column is what makes the two agree. The generator used to walk
`data/athyg/athyg_33_classic_ids.csv` and re-run `resolveGaiaSourceId`
**ungated** — re-deciding a binding the spine had frozen, against reference
tables that have moved since, and without the G−V / sibling-letter gates
the frozen build applied (`../spine/README.md` § The identifier columns are
read, never re-derived). The two lists then agreed only because the walk
over-pulled.

Rebasing dropped 3,304 ids and gained 134. The drops are rows the walk
never turned into records (2,968 with no distance, 1 past `MAX_DIST_PC`)
plus bindings the frozen gates had scrubbed to empty (205) or re-bound to
a different source (130). Those 130 re-bindings are the same ids as 130 of
the gains — the walk kept a rejected native `gaia` cell where the build
took the HIP cross-walk's answer.

The remaining **four gains are the substantive win**: ξ UMa A, ξ UMa B,
ξ Sco and HD 75632, whose identifiers the frozen build resolved AFTER its
walk (`../spine/README.md` § The identifier columns are read). Nothing had
ever requested their tier-1 astrometry.

## What the pulled set bounds

The request drives `scripts/refresh/refresh-gaia-astrometry-catalog.py` →
`data/gaia/gaia_dr3_astrometry_catalog.tsv`, which is tier 1 of the
direction cascade and the rv cascade, and the source of the BP/RP the V
and ci cascades transform.

It is also the evidence table for `../classic-ids/`' binding gate, which
reads `phot_g_mean_mag` per candidate source. A candidate the pull does
not cover cannot be magnitude-vetted and passes that check by default — so
narrowing this request narrows the gate, and `pnpm run build:classic-ids`
(CI asserts the overlay byte-identical) is what proves it did not.
