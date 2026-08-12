# Naming — WGSN ingest + designation normalisers

The build side of the naming-authority ladder (`docs/star-naming.md`):
normalises the IAU WGSN files and IV/27A's ASCII Bayer conventions into
one structured, keyed designation table plus the approved-name table.
`pnpm run build:wgsn` regenerates both under `data/iau-wgsn/`; CI asserts
the committed tables are byte-identical to what the committed code
produces. The display-name composer that consumes them is
`stellata-wgp3.3` — nothing on the `build:catalog` path imports this
folder yet.

## Files in this area

```
scripts/catalog/naming/
  greek-forms.ts                Canonical Greek glyph set, curly-variant
                                folds (ϕ→φ, ϵ→ε), the lowercase ASCII
                                conventions (SIMBAD `kap01`, IV/27A `alf` /
                                `ksi` / dotted `mu.`), and the genitive →
                                IAU-code map. AT-HYG's capitalised forms
                                (`Alp`) stay in src/client/typeahead/
                                star-designations.ts.
  wgsn-parse-pure.ts (+ test)   NEC.csv / wgsnFaints.csv parsers — the
                                pipeline's one comma-CSV source (quoted
                                cells), null spellings `_` / `~` / `null`,
                                `HIP nnn` and `nnnnnA` key cells.
  wgsn-normalise-pure.ts        Both § 4 normalisers. NEC `Bayer/other`
    (+ test)                    grammar → structured bayer / flamsteed /
                                gould / variable / non-stellar /
                                other-catalogue / corrupt; IV/27A `bayer`
                                cells → glyph + superscript, with the GCVS
                                contaminants rejected to the variable
                                class. Plus the multi-name cell split and
                                the diacritic fold used for name matching.
  build-wgsn-tables.ts          Orchestrator: normalise both WGSN files,
                                union the IV/27A Bayer tail, verify the
                                § 2 dispositions, write the two derived
                                tables, pin the counts.
  wgsn-expected.json            Pinned count snapshot
                                (UPDATE_BUILD_COUNTS=1 refreshes).
```

## The union policy

WGSN is the primary designation source; IV/27A supplies only the Bayer
tail — a cross-index Bayer row is added only when no WGSN Bayer
designation already reaches its star by HD or HIP (1,605 covered, 446
added). IV/27A Flamsteed numbers are **not** unioned: the record build
already carries `f` via the label merge and `dc` via the
designation-constellation cascade, and the cross index adds no glyph
content to them.

Classes that emit no designation row, all pinned: `variable` routes to
the GCVS tier (tier 6 sources it from GCVS itself — 614 NEC cells + 134
IV/27A contaminants), `non_stellar` (clusters / nebulae / galaxies, 132),
`other_catalogue` (BD / CD / Gliese / survey ids — the star still keys
via HIP / HR / HD, 95), `corrupt` (the ρ² Ara Mathematica artifact, 1).

## The § 2 residual gate

Every spine `proper` must either match a WGSN name key
(diacritic-folded, post multi-name-split — 445 of 491 do) or appear in
the hand-curated `data/iau-wgsn/athyg_proper_dispositions.tsv` (46 rows).
The build hard-fails on exact set inequality in either direction — the
route-disagreements review-join discipline — so a WGSN refresh that
approves a disposed name surfaces as a *stale disposition* failure, and
the fix is a data-row deletion, never a code edit.

## Measured coverage

Of the spine's 1,522 Bayer-bearing rows, the unioned table reaches 1,520
by HD or HIP. The 2 uncovered are close-pair component rows whose Bayer
belongs to the sibling record (ξ UMa B / HD 98230, and HD 79096's Pi-1
cell) — a WDS rooting question for the composer, not missing data.
