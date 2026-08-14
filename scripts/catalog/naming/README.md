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
                                cells), null spellings `_` / `~` / `-` /
                                `null`, and both key columns' inline
                                component letters (`HIP 518A`, `62264AB`).
                                A key shape covered by neither throws.
  wgsn-normalise-pure.ts        Both § 4 normalisers. NEC `Bayer/other`
    (+ test)                    grammar → structured bayer / flamsteed /
                                gould / variable / non-stellar /
                                other-catalogue / corrupt; IV/27A `bayer`
                                cells → glyph + superscript, with the GCVS
                                contaminants rejected to the variable
                                class. Plus the multi-name cell split and
                                the diacritic fold used for name matching.
  wgsn-tables-pure.ts (+ test)  Row shaping and the two joins: the IV/27A
                                Bayer union, the § 2 disposition set
                                comparison, the key sets both sides of the
                                union share, and the total sort order the
                                committed table's byte-for-byte CI diff
                                rests on. `spineProperKey` is the one
                                place the gate's join key is built.
  build-wgsn-tables.ts          Orchestrator: read, normalise, delegate
                                the joins, write the two derived tables,
                                pin the counts.
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
the GCVS tier (tier 6 sources it from GCVS itself — 615 WGSN cells + 134
IV/27A contaminants), `non_stellar` (clusters / nebulae / galaxies, 132),
`other_catalogue` (BD / CD / Gliese / survey ids, 95), `corrupt` (the
ρ² Ara Mathematica artifact, 1).

A two-capital head reads as GCVS **before** the Greek lookup, which is
case-insensitive over the ASCII abbreviations: `NU Pav` is the M6III
semiregular variable (HD 189124), and reading it as Greek minted a second
ν Pav onto it — the Bayer star ν Pav is HD 169978.

`other_catalogue` normally costs nothing because the star still keys by
HIP / HR / HD, with one exception worth knowing before wiring the
composer: **53 of the 509 approved names have no HIP, HR or HD at all**
(`namesKeyless`). They are wgsnFaints exoplanet hosts whose only
identifier is the survey id in the dropped cell — `WASP-32`, `HAT-P-29` —
and the file's WDS column, which would otherwise root them, is empty in
every row (`faintsWdsCells`, pinned at 0). Positionally, all but one sit
outside the spine entirely, so they name stars the catalogue does not
carry; the pins are there to catch a refresh that changes either fact.

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

Three designation rows carry no key at all (`designationsKeyless`):
β Cen B, δ Cyg B and ζ Her B spell both key cells `-` upstream. Seven
rows tie on every field (`designationDuplicateRows`), and seven name rows
repeat a name against the same keys (`nameDuplicateRows`) — NEC lists the
components of a close pair as separate serials, so Talitha, Acrab, Sabik
and the rest arrive twice. Neither table dedupes; the composer picks.
