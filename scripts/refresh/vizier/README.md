# Whole-table VizieR pulls

The pulls that take whole VizieR tables, a column subset each, on the
TypeScript runtime ([pull/README.md](../pull/README.md)). The refresh policy
and the per-script table are the parent's (`../README.md`).

| Step | VizieR table | Output |
|---|---|---|
| `refresh:classic-ids` | `IV/25/tyc2_hd`, `IV/27A/catalog`, `V/50/catalog`, `J/A+A/670/A19/cns5` | `data/classic-ids/{tyc2_hd,cross_index,bsc5,cns5}.tsv` |
| `refresh:hip-vmag` | `I/239/hip_main` | `data/hipparcos/hip_main_vmag.tsv` |
| `refresh:hip2` | `I/311/hip2` | `data/hipparcos/hip2_van_leeuwen.tsv` |
| `refresh:gliese` | `V/70A/catalog` | `data/gliese/gliese_v70a.tsv` |
| `refresh:msc` | `J/ApJS/235/6/{systems,orbits,catalog}` | `data/msc/msc_{systems,orbits,components}.tsv` |

Output paths are `DATA_FILES`' (`/src/catalog-format/pipeline-outputs/`), the
names the catalogue's and the binaries' sources read. A pull's tables land in
one emission, so classic-ids' four and msc's three commit together or not at
all; there is no per-table run.

## Files

- `vizier-pure.ts` — the ten `PullTable`s: each VizieR column under the name
  its TSV writes (`vizierColumn`), formats, sort keys, bands and spot rows.
- `vizier.ts` — the five `Pull`s; `vizier-outputs.ts`, their
  `declareOutputs`.
- `refresh-{classic-ids,hipparcos-vmag,hipparcos2,gliese,msc}.ts` — one entry
  per step.
- `vizier.test.ts` — each table's replies replayed into lines of its
  committed table, its spot rows and its sort order ([Replies](#replies)),
  and every query one quoted whole-table query to CDS.

## Columns and formats

VizieR's column names are case-sensitive and its table ids carry `/`, so
every identifier is quoted (`VIZIER.quote`); a column whose TSV name differs
is projected `"<VizieR name>" AS <tsv name>`. A VOTable `float` is written
`FLOAT` (`{repr: true, float32: true}`) and a `double` `DOUBLE`
(`{repr: true}`), the text numpy printed for the value astropy read, which
is what the committed tables hold. Which columns are which was read from each
table's VOTable `FIELD`s on the CfA mirror (2026-11-15); `V/70A`'s B1950
position is a computed `double` over TAP, sexagesimal text on ASU. Hipparcos'
printed V and B−V are `{fixed: 3, float32: true}`.

## Order

Each table is sorted by the key its Python pull ordered by, which reproduces
the committed bytes, except two:

- **`gliese_v70a.tsv`** sorts name then component by code unit. CDS's
  `ORDER BY Name, Comp` collated punctuation-blind (`Gl 100.1` before
  `Gl 10.1`); 245 of 3,803 rows moved, the same lines.
- **`msc_components.tsv`** sorts by `wds_id` then `comp`. The Python pull
  sent no `ORDER BY` and wrote CDS's reply order, which matched no key, not
  even VizieR's own record order (by ID); all 12,484 rows moved, the same
  lines, and `build:binaries` reads them into the same `multiples.tsv`.

Rows tied on the sort key keep the archive's order: 197 TYCs in `tyc2_hd`
carry two HD rows, and `wds_id` repeats in `msc_systems` and `msc_orbits`.

## Replies

CDS Strasbourg was unreachable when these pulls were ported, so the suite's
replies are synthetic: committed rows written in the CSV dialect ESA, ARI and
SIMBAD-Harvard answer with. They hold the projection's names, the formats and
the sort against the committed tables; CDS's own CSV dialect (quoting, a BOM,
the empty cell) stays unmeasured until its mirror verifies
([The TAP backend](../pull/README.md#the-tap-backend)). Each pull's record
was written from a checkpoint seeded with its committed rows, so its
`answeredBy` is empty until its first live run.
