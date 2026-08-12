# IAU WGSN — approved star names + glyph-bearing designations

The naming authority of `docs/star-naming.md`: the only in-tree source
with an approval process for star NAMES, and the only in-tree source of
Unicode Greek Bayer designations. Frozen upstream files plus the derived
keyed tables `pnpm run build:wgsn` regenerates from them.

```
NEC.csv                        986 KB. Frozen. The WGSN naked-eye catalogue,
                               2025-05: 9,297 rows over the V ≤ 6.5 sky —
                               377 approved names + 5,031 non-empty
                               `Bayer/other` designation cells (Unicode
                               glyphs), keyed HIP / HR / HD.
wgsnFaints.csv                 12 KB. Frozen. 132 approved names below
                               V 6.5 (exoplanet hosts, faint dwarfs),
                               with a WDS component column.
wgsn_names.tsv                 Derived. One row per approved name: display
                               name, published alternates split out of
                               multi-name cells, HIP / HR / HD (+ HD
                               component letter), WDS, Vmag, source file.
wgsn_designations.tsv          Derived. One row per normalised designation:
                               kind (bayer / flamsteed / gould), glyph
                               letter + superscript, dc, Serpens Gould
                               half, component, HIP / HR / HD, source
                               (nec / faints / iv27a).
athyg_proper_dispositions.tsv  Hand-curated. The § 2 residual: every spine
                               `proper` no WGSN name matches, classified
                               (discovery-designation / component-letter /
                               gould / catalogue / latin-bayer /
                               unattributed). build:wgsn hard-fails unless
                               this file enumerates exactly the unmatched
                               set — a later IAU approval moves a name by
                               data refresh + row deletion, never a code
                               edit.
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
  (NEC); see SCIENCE.md § Data sources.

## Upstream quirks the pipeline handles

Measured over the 2025-05 files; `scripts/catalog/naming/README.md` has
the per-class counts, `wgsn-expected.json` pins them:

- Comma-CSV with quoted cells (`"C5,5"` carbon-star types) — the one
  non-TSV source in the pipeline.
- `_`, `~` and a literal `null` (5 Virgo rows) all spell null.
- One corrupt `Bayer/other` cell: a Mathematica formula artifact on
  HIP 83057 (ρ² Ara). Classified `corrupt`, count pinned at 1; the star's
  Bayer designation arrives via the IV/27A tail instead.
- `82 G. Eri[3]` carries a footnote marker; stripped.
- Gould numbered Serpens' halves separately (`4 G. Ser Cap` ≠
  `4 G. Ser Cau`), so the half is part of the designation and rides its
  own column.
- `LO Hya (25 G. Hya)`: a GCVS form with the real designation in the
  parenthetical — the parenthetical wins, GCVS already sources the outer.
- 226 NEC `HD` cells carry a trailing component letter (`224782A`) —
  split into `hd` + `hd_component`.

## Consumed by

`scripts/catalog/naming/build-wgsn-tables.ts` (`pnpm run build:wgsn`)
reads the two frozen files plus `data/classic-ids/cross_index.tsv` (the
IV/27A Bayer tail) and `data/athyg/inherited-spine.tsv` (the § 2 residual
verification), and writes the two derived tables. CI re-runs the build
and fails on any diff, so artifact and code land together.

The derived tables' consumer is the display-name composer
(`stellata-wgp3.3`); nothing on the `build:catalog` path reads this
folder yet.

## Refresh

`pnpm run refresh:iau-wgsn` (schema, row-band, named-count and spot-row
gates; atomic replace), then `pnpm run build:wgsn` and commit both. The
WGSN publishes updates roughly annually; a refresh that adds an approved
name for a disposed AT-HYG proper will fail `build:wgsn` with a stale
disposition row — delete the row, the name now routes via the authority.
