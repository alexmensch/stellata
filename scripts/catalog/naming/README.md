# Naming — the authority ladder, its ingest, and the display-name composer

Everything that decides what a star is CALLED: the IAU WGSN ingest, the
designation normalisers, and the one pure composer that turns a record's
structured designation set into the string the app shows. The contract is
`docs/star-naming.md`; this folder implements it end to end.

Two entry points regenerate committed artifacts, both asserted
byte-identical in CI so artifact and code always land together:

- `pnpm run build:wgsn` — the keyed tables under `data/iau-wgsn/`.
- `pnpm run build:naming-parity` — the parity ledger (§ The parity ledger).

`build-catalog.ts` calls this folder twice: `applyStarNames` right after the
classic-ID label merge, and `assignDisplayNames` post-sort just before the
name table is written.

## Files in this area

```
scripts/catalog/naming/
  greek-forms.ts                GREEK_SPELLINGS — every published spelling
                                of each Greek letter, keyed by the glyph the
                                wire carries: `full` (Alpha), `abbr` (Alp),
                                and the lowercase ASCII `variants` (alf).
                                ASCII_GREEK derives from it, so a spelling
                                added for the build's normalisers reaches
                                the runtime's search labels too. Plus the
                                curly-variant folds (ϕ→φ, ϵ→ε) and the
                                genitive → IAU-code map.
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
  wgsn-index-pure.ts (+ test)   The record-side join: readers for the two
                                committed tables and the disposition file,
                                the keyed index, the three pickers, and the
                                § 2 class routing (§ The record-side join).
  apply-star-names.ts           I/O + the record pass: loads the committed
                                tables and writes each record's authority
                                tiers, aliases and designation
                                constellation. Also loads the curated
                                override table (`data/naming/`).
  star-naming-pure.ts (+ test)  THE COMPOSER. The ladder, the component
                                rules, the wire adapter. Imported by the
                                build AND by the runtime
                                (§ Two callers, one composer).
  display-names.ts              The build's half of the composer: every
                                record's designation set → its display
                                name, with the NAME tiers written into
                                `proper`.
  naming-parity-pure.ts         Ledger codec + the record-identity key and
                                the shared label resolver.
  build-naming-parity.ts        Refreshes the ledger from the built
                                artifacts.
  naming-parity.test.ts         The § 8 gate over the built artifacts.
  naming-parity.tsv             The display-change enumeration.
  naming-duplicates.tsv         Duplicate composed labels — data findings.
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
ν Pav onto it (the Bayer star ν Pav is HD 169978).

`other_catalogue` normally costs nothing because the star still keys by
HIP / HR / HD, with one exception worth knowing: **53 of the 509 approved
names have no HIP, HR or HD at all** (`namesKeyless`). They are wgsnFaints
exoplanet hosts whose only identifier is the survey id in the dropped cell
— `WASP-32`, `HAT-P-29` — and the file's WDS column, which would otherwise
root them, is empty in every row (`faintsWdsCells`, pinned at 0).
Positionally, all but one sit outside the spine entirely, so they name
stars the catalogue does not carry; the pins are there to catch a refresh
that changes either fact.

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
cell): both drop their own Bayer (`namingBayerDropped`) and take their
system's designation with their component letter instead, which is what
the authority's coverage actually asserts. Over the whole record set the
table reaches **2,005** records, 485 of which the spine printed no Bayer
cell for at all.

Three designation rows carry no key at all (`designationsKeyless`):
β Cen B, δ Cyg B and ζ Her B spell both key cells `-` upstream. Seven
rows tie on every field (`designationDuplicateRows`), and seven name rows
repeat a name against the same keys (`nameDuplicateRows`) — NEC lists the
components of a close pair as separate serials, so Talitha, Acrab, Sabik
and the rest arrive twice. Neither table dedupes; the pickers below do.

## The record-side join

`wgsn-index-pure.ts` answers, per record, which approved name and which
glyph-bearing designations reach it. Four things in it are easy to get
wrong, and each cost a wrong name before it was pinned:

**The key order is HR → HD → HIP.** Hipparcos resolved close pairs as ONE
star, so its number is the least component-specific of the three: NEC
lists both p Eri rows against HIP 7751 and separates them only by HR
(486 / 487) and HD (10360 / 10361). A HIP-first join collapses p Eri A and
B onto one record — the very duplicate `docs/star-naming.md` § 8.4 expects
the ladder to dissolve. `docs/star-naming.md` § 3 states HIP first and is
wrong; the order here is the measured one.

**The record's own printed name is the last key.** Three names the
authority approves reach no record by identifier: Albireo B, whose spine
row is HD 183914 against the authority's 183913, and the faints hosts
Kaewkosin and Maru, whose spine rows carry no identifier at all. A record
whose own `proper` folds to an approved name IS that star, and AT-HYG
asserting the same string is evidence rather than invention.
`namingIauNamedByProper` pins it at 3.

**An ambiguous number is not a key.** The join reads a record's
single-valued `hd` / `hr` only, never its `hdAlt` / `hrAlt`: an ambiguous
designation names a catalogue granularity (`../classic-ids/README.md`
§ The label merge), and joining through one attached another component's
Bayer letter to the wrong star.

**Three pickers settle the ties the tables leave.** For a NAME, the bare
row wins — `Albireo` over `Albireo A`, because the authority approved the
bare form for the star and the lettered one for a component of it. For a
Bayer designation, in precedence order: a Greek glyph over the Latin
overflow series (NEC hangs `y Cen B` on γ Cen's keys, and reading that
renamed γ Cen to `y Cen` and collided it with the real y Cen), then a row
with no component cell over a lettered one (γ Cen's keys carry all three of
`γ Cen`, `γ Cen A`, `γ Cen B`), then a superscripted row over the bare one
(β Sco and β¹ Sco both key HIP 78820 — the star is β¹ Sco).

**§ 2's classes route here, not in code.** `discovery-designation`,
`catalogue-designation` and `gould-designation` display their string
(`Ross 128`, `Cygnus X-1`, `268 G. Cet`); `component-letter`,
`unattributed` and `latin-bayer` keep theirs as a search-only alias.
`latin-bayer` is in both lists on purpose: the structured tier renders
`p Eri`, and `p Eridani` — the full genitive AT-HYG printed — is not
derivable from it. Sol is exempt rather than disposed: no catalogue names
it, and it carries its own string.

## The designation constellation

The authority states which constellation its own designation is named for,
so `applyStarNames` writes it as the top tier of the cascade the label
merge started (`../classic-ids/README.md` § The designation constellation),
covering 2,941 records. One `uint8` serves one designation and the tier
that COMPOSES the label owns it, so where the authority's Bayer names a
different constellation from the record's Flamsteed number — 16 Lyn is
also ψ¹⁰ Aur, `namingDesigConWgsnConflict` pins 2 — the displaced
Flamsteed form ships as an alias rather than going unsearchable.

## Two callers, one composer

`star-naming-pure.ts` is the single pure ladder, and it is a COLLECTION
pass rather than a per-star function because two of its three rules are
relational:

1. **The ladder** — curated override → IAU name → § 2 string designation →
   Bayer → Flamsteed → Gould → GCVS → catalogue (HIP → HD → HR → GJ).
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
`display-names.ts` and `designationSetOfEntry` are the two adapters, and
`catalog.bin`'s name table carries the NAME tiers alone (725 records) so
first paint has names while the runtime composes every designation off
`search-index.json` through the same function. That split is why
`FLAG_HAS_NAME` now means *an authority named this star* — a record
displaying a designation carries no name-table entry, and
`../catalog-lookup.ts`'s `name:` record refs resolve through the composer
for exactly that reason.

## The parity ledger

`docs/star-naming.md` § 8, as two committed TSVs plus
`naming-parity.test.ts`:

- **`naming-parity.tsv`** — one row per record whose displayed name changed
  when the ladder landed: `key` (the same gaia → hip → synth identity the
  runtime binaries loader resolves records through), `old`, `new`, and
  `resolves`. The `old` column is FROZEN: it is the string a user could
  have typed, and `resolves` records whether it still reaches that record.
  4,006 changes, 92 of them records that now display the runtime's
  identifier fallback.
- **`naming-duplicates.tsv`** — every display label two or more records
  compose, with its claimants. A RATCHET: each row is a curation finding
  upstream, and `../companions/multi-star-regression.test.ts` additionally
  refuses any within-one-WDS-root duplicate this file does not enumerate.

The gate is stated over strings with EXTERNAL provenance — every name the
authority approves and every name the spine printed must reach a record.
A string the build composed itself has no external existence, so § 5 lets
it disappear with the composition that made it; 1,994 do, and the ledger's
`resolves` column is where each one is reviewable.

`pnpm run build:naming-parity` refreshes `new`, `resolves` and the
duplicate list from the built artifacts. `key` and `old` carry forward from
the committed file; `NAMING_PARITY_SEED=<key/old TSV>` re-seeds them, which
is what a deliberate wholesale naming change needs and nothing else should
touch.
