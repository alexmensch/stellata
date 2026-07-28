# Hipparcos — CCDM cross-reference + HIP2 reduction

Two distinct Hipparcos-derived pulls:

```
hip_ccdm.tsv              ~2.2 MB, LFS. HIP↔CCDM cross-reference +
                          MultFlag — the curated visual-doubles flag.
hip_main_vmag.tsv         ~1.4 MB, LFS. Printed Johnson V per HIP —
                          the bright/printed tier of the V-magnitude
                          cascade.
hip2_van_leeuwen.tsv      ~8.5 MB, LFS. Hipparcos-2 reduction —
                          long-baseline astrometry for Gaia-saturated
                          bright primaries.
```

`hip_ccdm.tsv` and `hip_main_vmag.tsv` are two disjoint column slices of
the same VizieR table (`I/239/hip_main`), kept separate because their
consumers and refresh cadences differ.

## `hip_ccdm.tsv`

- **Source**: VizieR `I/239/hip_main` (Hipparcos main catalogue, ESA
  SP-1200, 1997). Three-column slice
  (`-out=HIP,CCDM,MultFlag`).
- **Licence**: Public domain via CDS.
- **CCDM**: Catalog of the Components of Double and Multiple stars
  (Dommanget & Nys 1994) — the curated pre-WDS register of visual
  doubles. Each Hipparcos row's `CCDM` column carries the
  cross-reference into that catalogue.
- **MultFlag gate**: a star is flagged as a visual double when
  `CCDM` is non-blank AND `MultFlag ∈ {C, G, O}` (component /
  resolved / orbit-known). Blank / `V` / `X` are dropped — these are
  CCDM-listed optical pairs Hipparcos didn't model. Filters out
  Vega-class line-of-sight chance alignments while keeping every
  Hipparcos-confirmed pair (Sirius, Mizar, Castor, α Cen, Albireo, …).
- **Why not TDSC / WDS directly**: TDSC saturates on the brightest
  stars (V ≲ 3); WDS doesn't carry HIP.

Consumed by `scripts/catalog/build-catalog.ts` (visual-doubles flag
in v6 bit 4) and `scripts/binaries/build-binaries.py` Stage 2
(CCDM tier of the WDS-component → Gaia source_id cascade). See
[`scripts/catalog/README.md`](../../scripts/catalog/README.md)
§ CCDM double-star cross-match for the gate semantics.

## `hip_main_vmag.tsv`

- **Source**: VizieR `I/239/hip_main`, two-column slice (`HIP`, `Vmag`),
  118,218 rows (one with a null `Vmag`). Rounded to 3 dp on write so the
  committed file is byte-stable across numpy versions.
- **Licence**: Public domain via CDS.
- **Role**: printed Johnson V for the bright / printed tier of the
  V-magnitude cascade (`docs/catalog-driver.md` § 5) — the rows whose Gaia
  photometry is missing or outside the Riello+ 2021 transform's validity
  range. Ingested ahead of that consumer; nothing reads it yet.
- **Refresh**: `pnpm run refresh:hip-vmag`.

## `hip2_van_leeuwen.tsv`

- **Citation**: van Leeuwen F. 2007, *A&A* 474, 653.
  DOI: [10.1051/0004-6361:20078357](https://doi.org/10.1051/0004-6361:20078357).
- **VizieR catalog**: `I/311/hip2`.
- **Licence**: Public domain via CDS.
- **Role**: long-baseline (≈1991.25 epoch) astrometry that complements
  Gaia DR3's 2014–2017 baseline. Two distinct fallback paths in
  `scripts/binaries/build-binaries.py` Stage 3:
  1. *Gaia-saturated bright primaries* (Sirius A, α Cen, Algol,
     Procyon) — no Gaia 5p row exists; HIP2 is the only astrometry.
  2. *Orbit-corrupted PMs in tight binaries* — when Hipparcos and
     Gaia disagree by >50 mas/yr on a system with min ρ ≤ 5″, HIP2
     is closer to the systemic motion since it averages a different
     window of the orbit.

  The catalog build mirrors both paths as direction-cascade tier 2
  (`scripts/catalog/distance/README.md` § Direction resolution), and
  re-derives `dist_src=HIP` rows' distances as 1000/plx at full
  precision when HIP2 reproduces AT-HYG's printed value.

## Refresh

`pnpm run refresh:hip2` →
[`scripts/refresh/refresh-hipparcos2.py`](../../scripts/refresh/README.md);
`pnpm run refresh:hip-vmag` → `refresh-hipparcos-vmag.py`. The CCDM slice
has no script — refetch from VizieR by hand when needed.
