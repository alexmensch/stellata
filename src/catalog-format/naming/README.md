# Naming — the display-name composer and the search corpus

The rules that turn a record's structured designation set into the string
the app shows, and the search corpus built from the same strings. The build
writes names with them and the viewer composes and searches with them, so
one copy serves both. The contract is `docs/star-naming.md`; the ingest
that feeds the ladder (WGSN, the curated tables, the parity ledger) is
[`/scripts/catalog/naming/`](/scripts/catalog/naming/README.md).

## Files in this area

```
src/catalog-format/naming/
  greek-forms.ts                GREEK_SPELLINGS — every published spelling
                                of each Greek letter, keyed by the glyph the
                                wire carries: `full` (Alpha), `abbr` (Alp),
                                and the lowercase ASCII `variants` (alf).
                                ASCII_GREEK derives from it, so a spelling
                                added for the build's normalisers reaches
                                the runtime's search labels too. Plus the
                                curly-variant folds (ϕ→φ, ϵ→ε) and the
                                genitive → IAU-code map.
  star-naming-pure.ts (+ test)  THE COMPOSER. The ladder, the component
                                rules, the wire adapter. Imported by the
                                build AND by the runtime
                                ([Two callers, one composer](#two-callers-one-composer)).
                                Each label is a `DisplayName`: `own` (its
                                tier, and its letter's source — the
                                authority's statement or a sibling owning
                                the designation) or `borrowed` (the anchor,
                                its tier, and which borrowing rule fired).
  star-designations.ts          The per-entry designation list
                                (`starDesignations`) plus the wire adapter
                                onto the composer (`designationSetOfEntry`).
  search-corpus.ts              The fuzzy corpus and the exact-match
                                identifier maps (`buildSearchIndex` and the
                                label builders). The build's naming parity
                                gate runs it to prove a name is findable;
                                the viewer's star search runs it at boot
                                (/src/client/typeahead/README.md#star-search).
```

## Two callers, one composer

`star-naming-pure.ts` is the single pure ladder, and it is a COLLECTION
pass rather than a per-star function because two of its three rules are
relational:

1. **The ladder** — curated override → IAU name → [§ 2](/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them) string designation →
   Bayer (Greek) → Flamsteed → Bayer (Latin) → Gould → GCVS → catalogue
   (HIP → HD → HR → GJ). **The Bayer tier is split**, because Bayer's Greek
   letters and his Latin overflow are read differently: `α UMa` outranks
   `50 UMa`, while atlases print `15 UMa` over `f UMa`. 313 records take
   their Flamsteed number back; the 237 with no Flamsteed number to take
   keep their letter (`namingTierBayerLatin` — the far-southern `p Eri` /
   `f Pup` series, outside what Greenwich could catalogue).
   The Gaia tail and the `SID #<n>` last resort below it belong to the
   runtime's `resolveStarName`: neither is a designation a catalogue
   published, neither reaches the search index, and composing them here
   would give every record a base and stop components borrowing.
2. **Borrowing.** A component takes its WDS root anchor's base plus its own
   letter wherever it holds no sky designation of its own — nothing at all
   (`Sirius B`, `HIP 82676 Ab`), a bare catalogue number (σ² UMa C reads
   better than its HIP 45064), an identifier-shaped GCVS serial (λ Oph B
   over `NSV 07784`), or a sky designation the SYSTEM also carries (ξ UMa
   B's Flamsteed 53 is ξ UMa's). A sky designation that singles the star
   out wins however high the anchor's tier: β² Sco stays β² Sco rather than
   becoming a lettered Acrab, and θ¹ Tau stays θ¹ Tau rather than borrowing
   θ² Tau's approved name.
3. **The letter.** Appended to a DESIGNATION only where it has to be: the
   authority attributes the designation to a component (`p Eri A` / `p Eri
   B`, which WDS letters only one of), or a sibling owns the same
   designation (four records own `θ¹ Ori`). A NAME never takes one — the
   authority's attribution IS the component statement, which is why Sirius
   A displays `Sirius` while Sirius B displays `Sirius B`.

Injective given (naming anchor, component letter). A surviving duplicate is
therefore two catalogue entries claiming one designation — a data finding,
never something the renderer should qualify away.

**The build calls it over `Star`; the runtime calls it over `SearchEntry`.**
`/scripts/catalog/naming/display-names.ts` and `designationSetOfEntry` (`star-designations.ts`) are the two adapters, and
`catalog.bin`'s name table carries the NAME tiers alone (<!-- count:build-catalog/namingNameTable -->729<!-- /count --> records) so
first paint has names while the runtime composes every designation off
`search-index.json` through the same function. A BORROWED label carries
its anchor's tier, so `Sirius B` is a name-table entry too — which is why
the table holds 725 records where the authority names only 447
(`namingTierIau` + `namingTierEponym`, not `namingIauNamed`). That split is why
`FLAG_HAS_NAME` now means *an authority named this star* — a record
displaying a designation carries no name-table entry, and
`/scripts/catalog/catalog-lookup.ts`'s `name:` record refs resolve through the composer
for exactly that reason.

