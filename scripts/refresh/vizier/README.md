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
  its TSV writes (`vizierColumn`), formats, sort keys, bands and spot rows;
  `vizierQuery`, one query as its ADQL parts and its ASU form, which the
  Tycho-2 bands build on too.
- `vizier.ts` — the five `Pull`s; `vizier-outputs.ts`, their
  `declareOutputs`.
- `refresh-{classic-ids,hipparcos-vmag,hipparcos2,gliese,msc}.ts` — one entry
  per step.
- `vizier.test.ts` — each table's replies replayed into lines of its
  committed table, its spot rows and its sort order ([Replies](#replies)),
  and every query one quoted whole-table query to CDS with the same table's
  ASU form for CfA.

## Two mirrors, one answer

`VIZIER` asks CDS's TAP first and falls back to the CfA (Harvard) mirror,
which serves VizieR's ASU interface and no TAP
([The TAP backend](../pull/README.md#the-tap-backend)). Both are asked for
FITS, so a double is written as stored, and a table sorts totally
([Order](#order)), so a pull either mirror answers writes the same bytes.
`vizierQuery` states each query once as both forms.

## Columns and formats

VizieR's column names are case-sensitive and its table ids carry `/`, so
every identifier is quoted (`VIZIER.quote`); a column whose TSV name differs
is projected `"<VizieR name>" AS <tsv name>`. A VOTable `float` is written
`FLOAT` (`{repr: true, float32: true}`) and a `double` `DOUBLE`
(`{repr: true}`): the shortest digits that read back to the stored value.
Which columns are which was read from each table's VOTable `FIELD`s on the
CfA mirror (2026-11-15); `V/70A`'s B1950 position is a computed `double`,
sexagesimal only in ASU's text output, which no pull reads. Hipparcos'
printed V and B−V are `{fixed: 3, float32: true}`.

## Order

Each table is sorted by the key that reproduces the committed bytes, with
two choices of key worth knowing:

- **`gliese_v70a.tsv`** sorts name then component by code unit, where CDS
  collates `Name` punctuation-blind (`Gl 100.1` before `Gl 10.1`).
- **`msc_components.tsv`** sorts by `wds_id` then `comp`: CDS's reply order
  matches no key, not even VizieR's own record order (by ID).
  `build:binaries` reads any order into the same `multiples.tsv`.

**The order is total**: after its keys, a table sorts on every other column
as text (`totalOrder`), so rows tied on the keys are written the same
whichever mirror answered — CDS and CfA send ties in different orders. Ties
on the keys are common: 197 TYCs in `tyc2_hd` carry two HD rows, and
`wds_id` repeats in `msc_systems` and `msc_orbits`. Only rows identical in
every column stay tied, and their order cannot show (three in
`msc_orbits`).

## Replies

CDS Strasbourg was unreachable when these pulls were ported, so the suite's
replies are synthetic: committed rows written in the CSV dialect ESA, ARI and
SIMBAD-Harvard answer with. They hold the projection's names, the formats and
the sort against the committed tables; CDS's own CSV dialect (quoting, a BOM,
the empty cell) stays unmeasured until its mirror verifies
([The TAP backend](../pull/README.md#the-tap-backend)). Each pull's record
was written from a checkpoint seeded with its committed rows, so its
`answeredBy` is empty until its first live run.
