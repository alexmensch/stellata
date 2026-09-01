# Gliese — printed values for the nearby-star cohort

One TSV from VizieR `V/70A`, the whole catalogue. Gliese is the first-order
source behind every spine cell marked `mag_src=GJ`: `docs/catalog-driver.md`
§ 5 routes the V cascade's bottom tier here for the GJ-bearing records
Tycho-2 does not carry.

```
gliese_v70a.tsv   3,803 rows from V/70A/catalog. Printed Johnson V (+ its
                  quality and reference flags), B−V, spectral type, the
                  weighted and trigonometric parallaxes, radial velocity,
                  and HD. Every row carries a `vmag`.
```

## Why this table exists at all

The cohort it serves is small — **16 records** — and every other tier was
checked first. Tycho-2 has no row for them (they carry no TYC), Gaia no
photometry (no `source_id`, or one DR3 does not publish), Hipparcos no entry.
**SIMBAD holds no Johnson V for them either**: the nine that reach the values
pull carry fluxes in `B`, `J`, `H`, `K`, `R`, `g`, `r`, `i` and `G` and no `V`
at all, so this is not the bibcode policy biting and no re-pull would fix it.

Without this tier those rows lose their V, and V is a membership gate
(`spineDroppedNoVMagnitude`, pinned at 0) — so retiring the spine's printed
`mag` cell without it would drop 16 records rather than re-source them.

## The printed cell IS this table

Over all 16 rows the tier serves, `vmag` reproduces the spine's printed `mag`
cell **exactly** — zero rows differ at the printed precision. That is the
measurement saying `mag_src=GJ` was a transcription of this catalogue all
along, so the swap re-sources the value first-hand without moving it. The
same reduction covers the whole spine: all **3,147** `gl`-bearing spine cells
resolve here.

## The join key

`Name` is **not** unique — a resolved system carries one row per component, so
`Gl 559 A` and `Gl 559 B` are two rows while `Gl 165 AB` is one row covering
both. The key is `Name` + `Comp`, reduced to the bare number so the two sides
can meet: V/70A numbers its entries under four prefixes (`Gl` 1,745 · `NN`
1,388 · `GJ` 384 · `Wo` 285) where a record's own `gl` cell carries
only `Gl` / `GJ`. The GJ 3xxx and 4xxx numbers this tier exists for are
printed `NN nnnn`, so a prefix-sensitive key would miss every one of them.
The remaining row is the Sun, whose `Sun` name matches no prefix and so
indexes under itself — no record's `gl` cell reaches it.

Where the catalogue resolved a system into components and a record's cell
names none of them, the bare number answers with the **alphabetically first**
component, which the pull's `order_by=("Name", "Comp")` makes stable across
re-pulls rather than a function of row order. 403 numbers are in that shape;
no spine cell reaches one today (measured over all 3,147 `gl` cells, 2,566 of
them bare), so this decides nothing yet and would need revisiting if the
magnitude pull widens the cohort.

A record naming a component the catalogue never resolved falls back to the
system entry — `Gl 165A` reads the `Gl 165 AB` row — which is why a V from
this tier is a **system blend** (`vTierIsSystemBlend`).

## Provenance

- **Citation**: Gliese W., Jahreiss H. 1991, *Preliminary Version of the Third
  Catalogue of Nearby Stars*, CDS `V/70A`.
- **VizieR**: `V/70A/catalog`, over the CDS TAP endpoint
  `refresh_lib.CDS_TAP_URL` names.
- **Retrieved**: 2026-08-27.
- **Licence**: CDS/VizieR standard academic use; cite Gliese & Jahreiss 1991.

V/70A is a completed 1991 publication, so upstream will not republish; the
successor is CNS5, which this repo already holds
(`data/classic-ids/cns5.tsv`) and which **publishes no Johnson V** — its
photometry is Gaia `G`/`BP`/`RP`, 2MASS `J`/`H`/`Ks` and WISE. That is why
the newer catalogue does not retire this one.

## Consumed by

- `scripts/catalog/gliese-parse.ts` → the V cascade's `gliese` tier
  (`scripts/catalog/photometry/README.md` § The V cascade). Only the `vmag`
  column is read so far — the parser adds a field per bead, the same terms as
  `data/simbad/simbad_values.tsv`.

## Refresh

`pnpm run refresh:gliese` (venv per `scripts/refresh/README.md`
§ One-time setup). `--force` overrides the mtime skip.
