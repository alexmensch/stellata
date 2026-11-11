# SIMBAD sp_type per WDS component

`refresh:simbad-wds-sptype` — SIMBAD's `sp_type` for every object
`data/simbad/simbad_wds_xids.tsv` binds a WDS component to, written to
`data/simbad/simbad_wds_sptype.tsv` (`simbad_oid`, `sp_type`). The first
TypeScript pull on the [pull runtime](../pull/README.md).

## Files

- `refresh-simbad-wds-sptype.ts` (+ test, the table through `runPull` on a
  faked transport) — the entry: `describe` and `main`.
- `simbad-wds-sptype-pure.ts` (+ test) — `wdsOids`, the request, read off
  `SIMBAD_WDS_XIDS` (`../../catalog/membership/binding/`), and
  `wdsSptypeTable`, the table: query, sort, row band and spot rows.
- `simbad-wds-sptype-outputs.ts` — the step's output declaration.

## Why it is its own pull

`build:binaries` reads only these rows, joined on `simbad_oid`
([Stage 6](../../binaries/multiples/README.md#what-each-column-carries)). While they
shared `simbad_sptype.tsv` with the manifest-keyed rows, binaries read a file
whose request derives from the membership manifest, which itself reads
`multiples.tsv`: a loop through committed files
([Loops through committed files](../../pipeline/README.md#loops-through-committed-files)).
This pull's request is `simbad_wds_xids.tsv` alone, which no manifest moves,
so the loop is gone. `refresh:simbad-sptype` keeps the manifest-keyed rows.

## The request and the gates

Every distinct `simbad_oid` in `simbad_wds_xids.tsv`, `oid IN (…)` against
SIMBAD's `basic` table, `SIMBAD_BATCH_SIZE` (`../pull/tap-pure.ts`) per query. An oid answers one
row, so the band's ceiling is the request; its floor is `MIN_OID_REACH` of
it, since an oid SIMBAD has merged away answers nothing. An object with no
type ships with an empty `sp_type`, so the file's row count is the reach
and the coverage line the share typed. Spot rows: Sirius A (`A0mA1Va`) and
40 Eri B (`DA2.9`).

The committed file is the rows of the last `refresh:simbad-sptype` pull
whose oid this request names, replayed through `runPull` from a checkpoint
with no query sent, so its record's `answeredBy` is empty. Its first live
run is a re-pull like any other: SIMBAD re-types objects with no release to
pin, so expect a few `sp_type` cells, and `multiples.tsv` with them, to move.

