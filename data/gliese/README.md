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
this tier is a **system blend** (`vTierIsSystemBlend`). Both derived keys are
sound for what this tier serves: a blended V is what the fallback advertises,
and a parallax read off the system entry is a distance the components share.

## The parallax is half the column, and the other half is not astrometry

`plx_mas` is V/70A's **resulting** parallax, which is the trigonometric one
only sometimes. The catalogue states the rule itself: the resulting parallax
"is always the trigonometric parallax — if the relative error of the
trigonometric parallax is smaller than 14 percent", and "is the photometric or
spectroscopic parallax only if no trigonometric parallax is available or if the
standard error of the trigonometric parallax is considerably larger."

`n_plx` is how a row says which it did, and **every code the column carries
names a non-trigonometric value**: `r` a parallax from spectral types and
broad-band colours, `w` a photometric parallax for white dwarfs, `s` and `o`
photometric parallaxes from Strömgren photometry, `p` one from other colours.
A blank is the catalogue stating the resulting parallax IS the trigonometric
one. The split is close to even — 1,905 blank against 1,898 coded — so reading
the column unconditionally takes an estimate about half the time:

```
awk -F'\t' 'NR>1{c[$13]++} END{for(k in c) print (k==""?"(trigonometric)":k), c[k]}' \
  data/gliese/gliese_v70a.tsv
```

**So `parseGlieseTsv` represents `plxMas` only where `n_plx` is blank**, and
nulls it everywhere else — a photometric parallax is unrepresentable rather
than merely discouraged, the same shape `citedParallax` gives an uncited value.
That is what makes the parallax cascade's exemption honest: it excuses this
tier from both skip rules because nothing later withdrew the measurement, and a
colour-magnitude estimate is not a measurement that could be withdrawn. It is
also **circular** for this build in a way the skip rules do not otherwise
reach: a distance from spectral type and colour, inverted and then used to
derive the record's own absolute magnitude, assumes the answer.

Verified against the catalogue's own statement rather than trusted: on the
1,905 blank rows `plx_mas` equals the row's `trplx_mas` on 1,898, and not one
carries a resulting parallax without a trigonometric one. The 7 that differ are
three resolved systems where the adopted value is the system's — still
trigonometric in origin. None of the 1,904 usable rows falls below the
cascade's S/N floor, and 312 sit in the 1–5 band it counts but ships.

`trplx_mas` is in the table and deliberately not the value read: its own error
column (`e_trplx`) is not in this slice, so gating on `n_plx` and reading the
resulting parallax keeps value and error bar from the same pair of columns.

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
  (`scripts/catalog/photometry/README.md` § The V cascade) and the parallax
  cascade's trigonometric tier
  (`scripts/catalog/distance/parallax/README.md`). `vmag`, `bv`, `sp` and the
  `n_plx`-gated `plx_mas` / `e_plx_mas` are read; the parser adds a field per
  bead, the same terms as `data/simbad/simbad_values.tsv`.

## Refresh

`pnpm run refresh:gliese` (venv per `scripts/refresh/README.md`
§ One-time setup). `--force` overrides the mtime skip.
