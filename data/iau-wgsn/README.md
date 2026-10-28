# IAU WGSN — approved star names + glyph-bearing designations

The naming authority of `docs/star-naming.md`: the only in-tree source
with an approval process for star NAMES, and the only in-tree source of
Unicode Greek Bayer designations. Frozen upstream files plus the derived
keyed tables `pnpm run build:wgsn` regenerates from them.

```
NEC.csv                        986 KB. Frozen. The WGSN naked-eye catalogue,
                               2025-05: 9,297 rows over the V ≤ 6.5 sky —
                               377 approved names + 4,971 non-empty
                               `Bayer/other` designation cells (Unicode
                               glyphs), keyed HIP / HR / HD.
wgsnFaints.csv                 12 KB. Frozen. 132 approved names below
                               V 6.5 (exoplanet hosts, faint dwarfs). Its
                               WDS column is empty in every row — the
                               build pins that at 0 rather than carrying an
                               empty column into the derived table.
wgsn_names.tsv                 Derived. One row per approved name: display
                               name, published alternates split out of
                               multi-name cells, HIP / HR / HD (each key
                               with its component letter), Vmag, source
                               file.
wgsn_designations.tsv          Derived. One row per normalised designation:
                               kind (bayer / flamsteed / gould), glyph
                               letter + superscript, dc, Serpens Gould
                               half, component, HIP / HR / HD, source
                               (nec / faints / iv27a).
athyg_proper_dispositions.tsv  Hand-curated. The /docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them residual: every spine
                               `proper` no WGSN name matches, classified
                               (discovery-designation / component-letter /
                               gould / catalogue / latin-bayer /
                               unattributed). build:wgsn hard-fails unless
                               this file enumerates exactly the unmatched
                               set — a later IAU approval moves a name by
                               data refresh + row deletion, never a code
                               edit.
wgsn_faints_corrections.tsv    Hand-curated. wgsnFaints.csv cells that are
                               not what their column says, set right before
                               the parse reads them: wgsn_id, column, value,
                               evidence. Three rows today, the Vmag cells
                               below.
```

All files stay on regular git (none exceeds the ~1 MB LFS threshold, and
row-level diffs are the review surface for the derived tables).

## Provenance

- **Source**: IAU Division C Working Group on Star Names, 2025-05 release.
  Files hosted by the WGSN chair at
  https://exopla.net/iau-wgsn-catalogs/ (fetched from
  `/wp-content/uploads/2025/05/`). Retrieved 2026-08-12.
- The older fixed-width `IAU-CSN.txt` (2022-04, 451 rows) is **superseded**
  by this pair — do not ingest it.
- **Licence**: CC-BY-4.0 (IAU data policy).
- **Citation**: IAU WGSN, Mamajek E. et al. — WGSN naked-eye catalogue
  (NEC); see [Data sources](/SCIENCE.md#data-sources).

## Upstream quirks the pipeline handles

Measured over the 2025-05 files; `scripts/catalog/naming/README.md` has
the per-class counts, `wgsn-expected.json` pins them:

- Comma-CSV with quoted cells (`"C5,5"` carbon-star types) — the one
  non-TSV source in the pipeline. The corrupt cell below is quoted and
  contains four commas, so a naive split shifts that row's keys.
- `_`, `~`, `-` and a literal `null` (5 Virgo rows) all spell null.
- One corrupt `Bayer/other` cell: a Mathematica formula artifact on
  HIP 83057 (ρ² Ara). Classified `corrupt`, count pinned at <!-- count:wgsn/cellCorrupt -->1<!-- /count -->; the star's
  Bayer designation arrives via the IV/27A tail instead.
- **wgsnFaints.csv's `Vmag` column is a V magnitude, and three of its cells
  are not**: Atakoraka (WGSN-ID 10032), Kaewkosin (10039) and Solaris (10117)
  print `G12.53`, `G11.36` and `G9.36` — a Gaia G in the V column, in a file
  with no Gmag column. The parse reads Vmag strictly, so
  `wgsn_faints_corrections.tsv` empties those three cells, each row with its
  evidence, before the parse sees them. The file keeps the corrections
  discipline the spine's has ([Cell corrections](/scripts/util/tsv/README.md#cell-corrections)):
  a row keying no faints row, or restating the cell's current value, fails
  `build:wgsn` — so a refresh that fixes the cells upstream retires its row
  rather than leaving it to do nothing.
- `82 G. Eri[3]` carries a footnote marker; stripped.
- Gould numbered Serpens' halves separately (`4 G. Ser Cap` ≠
  `4 G. Ser Cau`), so the half is part of the designation and rides its
  own column.
- `LO Hya (25 G. Hya)`: a GCVS form with the real designation in the
  parenthetical — the parenthetical wins, GCVS already sources the outer.
- Both key columns inline a component letter on close pairs: <!-- count:wgsn/hdComponentCells -->229<!-- /count --> `HD`
  cells (`224782A`, and 3 two-letter `62264AB`) and <!-- count:wgsn/hipComponentCells -->35<!-- /count --> `HIP` cells
  (`HIP 518A`), split into `hd` / `hip` + their component. A key shape
  that is neither this nor a null spelling fails the build rather than
  nulling the row.
- `NU Pav` is the GCVS variable HD 189124, not a Bayer letter; the ASCII
  Greek lookup is case-insensitive, so the normaliser tests the GCVS form
  first (ν Pav proper is HD 169978).

## Consumed by

`scripts/catalog/naming/build-wgsn-tables.ts` (`pnpm run build:wgsn`)
reads the two frozen files, `wgsn_faints_corrections.tsv`, plus `data/classic-ids/cross_index.tsv` (the
IV/27A Bayer tail, through `readCrossIndexTable` so its curated corrections
apply) and `data/membership/membership-manifest.tsv` (the [§ 2](/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them) residual
verification), and writes the two derived tables. CI re-runs the build
and fails on any diff, so artifact and code land together.

`build-catalog.ts` reads the derived tables through
`scripts/catalog/naming/apply-star-names.ts`, which writes each record's
approved name, glyph-bearing designations, aliases and designation
constellation. The display-name composer renders from those
(`scripts/catalog/naming/README.md`).

## Refresh

`pnpm run refresh:iau-wgsn` (schema, row-band, named-count and spot-row
gates; atomic replace), then `pnpm run build:wgsn` and commit both. The
WGSN publishes updates roughly annually; a refresh that adds an approved
name for a disposed AT-HYG proper will fail `build:wgsn` with a stale
disposition row — delete the row, the name now routes via the authority.
