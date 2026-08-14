# Star naming — authority ladder, canonical designations, aliases

The contract governing what name a star **displays**, what a user can
**type** to find it, and where each comes from. Membership, identifiers and
per-field sourcing are `docs/catalog-driver.md`; this document is the
naming half the driver gate deferred. The decision record lives in bd
(epic `stellata-wgp3`, design gate `stellata-wgp3.1`). External tables
verified 2026-07-28.

## 1. The model

Three things AT-HYG's `proper` column conflates are separated:

```
NAME        an authority approved this string for this star.       ~450 stars
DESIGNATION a catalogue's systematic label, rendered.              catalogue-wide
ALIAS       a string that resolves a search but never displays.    unbounded
```

Every displayed label is one of the first two, produced by **one pure
composer** from the star's structured designation set:

```
display(star) = render(highest tier the star carries) [+ component letter]
```

The composer (`scripts/catalog/naming/star-naming-pure.ts`, `stellata-wgp3.3`)
is imported by the build — which fills `catalog.bin`'s name table with its
output — and by the runtime, which renders labels, typeahead rows and the
focus card from the same function. **No caller composes a display string of
its own.** That single rule is what fixes the 536 names currently spelled
`The-1 Ori C`: the build composed them by hand and never reached the glyph
renderer the runtime already had.

## 2. Authority — one source approves names; everything else compiles them

| Source | Status | Supplies | Citation |
|---|---|---|---|
| IAU WGSN `NEC.csv` | **authority** | 377 approved names + 4,971 glyph-bearing Bayer/Flamsteed/Gould designations over the V ≤ 6.5 sky (9,297 rows) | IAU Div. C WG on Star Names, 2025-05 |
| IAU WGSN `wgsnFaints.csv` | **authority** | 132 approved names below V 6.5; its WDS column ships empty | same, 2025-05 |
| `IV/27A` cross index | mechanical | Bayer/Flamsteed for the sub-naked-eye tail (`data/classic-ids/`) | Kostjuk 2004 |
| `V/50`, `IV/25`, CNS5, `I/239` | mechanical | HR / HD / GJ / HIP designations | `docs/catalog-driver.md` § 2 |
| WDS / CCDM / MSC | mechanical | component letters | `docs/science-multiple-star-pipeline.md` |
| GCVS 5.1 | mechanical | variable-star designations | `data/gcvs/README.md` |
| AT-HYG `proper` / `bayer` | **rejected as authority** | alias candidates only (§ 5) | — |
| Stellarium `common_names` | **rejected as authority** | 659 HIP-keyed folk names, alias candidates only | `data/stellarium/README.md` |
| SIMBAD live resolution | **rejected** | — | frozen-data policy, `data/README.md` |

The IAU list is the only source with an approval process. It is also the
**only in-tree source of Unicode Greek designations**: it ships
`α Andromedae`, `ϕ Cassiopeiae`, `β 1 Tucanae` directly, covering **1,494 of
our 1,522 Bayer records** and 2,372 of 2,724 Flamsteed ones. Stellarium's
skyculture file, which `stellata-wgp3`'s description named as the glyph
source, contains **zero Greek glyphs** — only constellation lines and folk
names.

Two IAU properties beyond the names make it load-bearing:

- **Component attribution.** The authority answers *which* star owns a
  name rather than leaving it composed: 35 HIP and 229 HD cells inline the
  component letter (`HIP 518A`, `62264AB`), and the name itself carries one
  where the IAU approved it. `Acrab` belongs to β Sco **Aa**; AT-HYG hangs
  `Acrab B` on the WDS **C** component. Component-lettered names are not
  per se inventions — `Albireo A` is IAU-approved — so the letter question
  is always "what does the authority say", never "do we append one". The
  faints file's own WDS column is empty in every row, so component rooting
  comes from the key cells, not from it.
- **Designation constellation ≠ positional constellation.** NEC lists
  `ρ Aquilae` with `constellation = Delphinus`, the same split
  `stellata-sp4q.2` introduces as `dc`. The authority agrees with the
  design; it is also an independent check on the positional assignment.

### Measured: AT-HYG's 491 proper names against the authority

Diacritic-folded, over `data/athyg/inherited-spine.tsv`:

| Class | Count | Disposition |
|---|---|---|
| IAU-approved | **445** | name tier, unchanged. 442 match a name cell outright; 3 sit inside a multi-name cell (`Nganurganity / Unurgunite`, `Yunü (Yunu)`, `Bake-eo (or Bake Eo)`) and are only found once § 4's normaliser splits it |
| discovery / eponymous designation | 21 | designation tier (`Ross 128`, `Kapteyn's Star`, `Lacaille 9352`, `Lalande 21185`, `Kruger 60`, `Struve 2398 A`) |
| IAU name + AT-HYG component letter | 8 | alias only (`Acrab B`, `Cor Caroli B`, `Revati B`, …) |
| Gould designation | 3 | designation tier (`268 G. Cet`) |
| catalogue designation filed as a name | 2 | designation tier (`Cygnus X-1`, `EZ Aqr`) |
| Latin-letter Bayer filed as a name | 1 | Bayer tier (`p Eridani` → `p Eri A` / `p Eri B`, per NEC) |
| unattributed | **10** | **alias only** — the star displays its designation |
| `Sol` | 1 | hand-emitted record, exempt |

The residual cost of strict authority is 10 names, not 495. Seven stars
**gain** a name AT-HYG never carried (`Unurgunite`, `Alrakis`, `Phoenicia`,
…), and spellings the IAU superseded are corrected rather than dropped
(β Cet is `Diphda`, not AT-HYG's `Deneb Kaitos`).

The 10 are enumerated here because the count is otherwise soft in both
directions, and because they are **not** data errors — each is a real name
from pre-IAU atlas literature, applied to a star the WGSN has not named:

| Name | Star | What it actually is |
|---|---|---|
| `Cih` | γ Cas (HIP 4427) | traditional name; in NEC, no IAU name |
| `Ras Elased Australis` | ε Leo (HIP 47908) | traditional name; in NEC, no IAU name |
| `Udkadua` | λ And (HIP 116584) | non-Western star name |
| `Tusizuo` | 109 Her (HIP 90139) | non-Western star name |
| `Bodu` | 95 Her B (HIP 88267) | non-Western star name, component-specific |
| `Honores` | 7 And (HIP 114570) | obsolete asterism (Bode's *Honores Friderici*) |
| `Ramus` | 102 Her (HIP 88886) | obsolete asterism (*Ramus Pomifer*) |
| `Deltoton` | δ Tri (HD 13974) | ancient name of the **constellation** Triangulum |
| `Red Rectangle` | HD 44179 | the name of the **nebula**, not the star |
| `Onkaria` | no HIP, no HD | AT-HYG row addressable by neither |

So the pattern in AT-HYG's column is not typos: it mixes star names with
constellation, asterism and nebula names, plus non-Western names, all
unattributed. Alias-only disposes of every row without judging any of them.

Any name here that later gains IAU approval must move tiers through a data
refresh, never a code edit — which is why the list is committed at ingest
(`stellata-wgp3.2`) rather than expressed as a code exception.

## 3. The ladder

Display resolution order, first hit wins:

1. **Curated override** (§ 7) — the escape hatch, empty by default.
2. **IAU WGSN approved name** — `NEC` ∪ `wgsnFaints`, keyed HIP → HR → HD.
3. **Bayer** — glyph + superscript + designation constellation.
4. **Flamsteed** — `<number> <dc>`.
5. **Gould** — `<number> G. <dc>`. New tier; the authority carries 936.
6. **GCVS variable designation** — `R CrB`, `V645 Cen`.
7. **Catalogue designation** — HR → HD → HIP → GJ → Gaia DR3, as today.
8. **`SID #<n>`** — the existing last-resort identity label.

A **component letter** from WDS/CCDM appends to whichever tier won
(`θ¹ Ori C`, `p Eri B`, `HIP 81702 Ab`) — appended by the composer, never
baked into the tier's own string. Where the authority names a specific
component, that name attaches to that record alone; siblings resolve down
the ladder on their own.

AT-HYG's `proper` column appears nowhere in this list. Its 442 confirmed
names arrive through tier 2 (the authority asserts them); the rest are
reclassified by § 2's table. That is the demotion `stellata-wgp3` asked
for, expressed as *routing by class* rather than a curated exception list.

## 4. Canonical designation forms

One representation per designation kind, normalised at ingest. The wire
carries **structure**; every spelling is derived (§ 5).

| Kind | Canonical | Wire (`SearchEntry`) |
|---|---|---|
| Bayer letter | the Unicode glyph — `α` for Greek, bare letter for Latin (`p`, `A`) | `b` |
| Bayer superscript | integer 1–9, absent when none | `bx` |
| Flamsteed | integer | `f` |
| Gould | integer | `gd` |
| designation constellation | IAU 3-letter code | `dc` (`stellata-sp4q.2`), mandatory wherever `b`/`f`/`gd` is set |
| component | WDS/CCDM letter string | `cl` + `cp`, as today |

The glyph *is* the canonical letter, so rendering is `b + sup(bx) + ' ' + dc`
and no consumer parses a Bayer string. This retires the `"Alp-1"` /
`"alf01"` reconciliation the epic feared: the authority ships the glyph, and
both ASCII conventions become *inputs to a normaliser*, never a stored form.

**NEC normaliser** (`stellata-wgp3.2`, shipped —
`scripts/catalog/naming/wgsn-normalise-pure.ts`; every count here is
pinned in `scripts/catalog/naming/wgsn-expected.json`, which supersedes
the estimates this section carried from the gate's probe):

- Curly Greek variants fold to standard: `ϕ → φ` (41 rows), `ϵ → ε` (74).
- `letter <digit> <Genitive>` → glyph + superscript; genitive → 3-letter
  code (`Andromedae → And`), matched longest-first for the two-word
  genitives.
- SIMBAD-form rows `* kap01 Scl B` (264) carry a component — parse letter,
  index and component, not just the letter.
- The two files carry 5,031 non-empty cells, 5 of which spell null
  (literal `null`). The 5,026 classified: 1,724 Bayer · 1,521 Flamsteed ·
  938 Gould · 615 variable (routed to tier 6, never tier 3) · 132
  non-stellar dropped (`NGC 129`, `M 31`, `NAME SMC`, clusters) · 95
  other-catalogue dropped (BD / CD / Gliese / survey ids) · 1 corrupt (a
  Mathematica artifact on ρ² Ara, whose Bayer arrives via the IV/27A
  tail). NEC alone holds 4,971 of the non-empty cells.
- A two-capital head is a GCVS designation and is tested before the Greek
  lookup, which is case-insensitive over the ASCII abbreviations:
  `NU Pav` is the variable HD 189124, and reading it as Greek mints a
  second ν Pav onto it (the Bayer star is HD 169978).
- Dropping an other-catalogue cell normally costs nothing — the row still
  keys via HIP/HR/HD. The exception: 53 wgsnFaints names whose only
  identifier was that cell (`WASP-32`, `HAT-P-29`), with an empty WDS
  column and, bar one, no spine star within 30″. They name stars the
  catalogue does not carry.
- Gould numbered Serpens' halves separately (`4 G. Ser Cap` ≠
  `4 G. Ser Cau`) — the half rides the designation table.
- Multi-name cells split into name + aliases: `Nganurganity / Unurgunite`,
  `Yunü (Yunu)`, `Bake-eo (or Bake Eo)`.

**IV/27A normaliser** (the V > 6.5 tail, same module): `ksi → ξ`,
trailing-period forms (`mu.`, `nu.`, `pi.`), zero-padded indices
(`alf01`), and **GCVS-style cells rejected** from the Bayer field
(`R And`, `RZ Cas`, `AR Aur`, `V380 Cyg`) — variable designations tier 6
already sources from GCVS. Measured over all 2,185 Bayer cells (pinned):
2,051 parse as Bayer (0 unparsed) · 134 GCVS contaminants rejected. The
union adds 446 of the 2,051 as the tail; 1,605 are already covered by a
WGSN designation on the same star.

**Gliese prefix.** Display `GJ <number><component>` uniformly. `Gl` (Gliese
1969) and `GJ` (Gliese–Jahreiß supplements) are both legitimate printed
forms, so both stay searchable — `normalizeGlKey` already strips the prefix
— but neither AT-HYG's split (1,414 `Gl` / 1,733 `GJ`) nor a
classic-vs-supplement flag CNS5 does not carry is reproduced.

## 5. Aliases — ship what cannot be derived, derive what can

The dividing line, and the reason the search index does not grow much:

- **Derived at runtime, never shipped.** Every ASCII spelling of a Bayer
  letter (`Alp`, `Alf`, `Alpha`, `α`), constellation-name expansions
  (`Alpha Centaurus`), GCVS zero-padding variants (`V0645`/`V645`), Gliese
  prefix forms, and `<system> <letter>` component forms. All are pure
  functions of § 4's structure — `buildBayerLabels` / `buildComponentLabels`
  already work this way and keep doing so.
- **Shipped in `al?: string[]`.** Only strings no structure implies:
  displaced AT-HYG names (`Acrab B`, `Deltoton`), IAU alternates split out
  of a multi-name cell, and — optionally, `stellata-wgp3.2`'s call —
  Stellarium's 659 folk names with their reference provenance.

**An alias must have been published outside this repository.** Its purpose
is to keep resolving a string a user could have encountered elsewhere; a
string *our own build composed* has no external existence, so it gets no
alias and disappears with the composition that made it. The distinction is
provenance, not plausibility:

| String | Origin | Alias? |
|---|---|---|
| `Acrab B` | AT-HYG's own `proper` cell, on β² Sco | **yes** — published upstream |
| `Acrab C` | our `resolveComponentNameCollisions`, rewriting the above | **no** |
| `The-1 Ori C`, `3 Gem B`, `HIP 81702 Ab` | our build's composition (536 + 517 + 7,967 records) | **no** |
| `p Eridani B` | our promotion pass; AT-HYG has only `p Eridani` ×2 | **no** |

Worth stating because β² Sco shows both halves at once: AT-HYG ships
`Acrab B` on a star WDS calls component **C**, and our collision resolver
already rewrote that to `Acrab C`, so today's shipped display name is ours
layered on AT-HYG's mistake. The ladder keeps the upstream string
searchable, drops ours, and displays `β² Sco`.

`V/50`'s `name` column (`3Alp Lyr`, 3,157 rows, committed and read by
nothing) is **rejected**: it is Flamsteed + Bayer + constellation, fully
derivable from designations we already carry. The column stays in the frozen
slice as provenance; no consumer is added.

Nothing that resolves a search is lost by a demotion. That is the
invariant the parity gate (§ 8) enforces.

## 6. Rendering — glyphs everywhere, no fallback path

Unicode Greek + superscript digits render in every surface today (typeahead
primary lines, chart-mode SVG labels, focus card) via `BAYER_GREEK` /
`superscript` in `src/client/typeahead/search.ts`; α¹ Cen ships now. So the
glyph policy is **no ASCII fallback and no font-detection machinery** — the
only surface missing glyphs is the build-composed name table, which stops
being hand-composed (§ 1).

Two couplings the composer must get right, both currently latent bugs:

- **Render against `dc`, never the positional constellation.** Today
  `formatBayerDisplay(entry.b, conCode)` reads `entry.c`. Once
  `stellata-sp4q.2` makes `c` IAU-positional, that path renames ρ Aql to
  `ρ Del`. The composer takes `dc ?? c` explicitly; the positional
  constellation stays a membership attribute (hover line, focus-card
  Constellation row, `highlightCon`, chart centroids).
- **One composer, both sides.** The build fills the name table by calling
  the same pure function the runtime renders with, so `catalog.bin` keeps a
  display name per record (no first-paint regression while
  `search-index.json` is in flight) and cannot drift from the runtime's
  spelling.

## 7. Curation seam

A committed override table, `data/naming/name_overrides.tsv`, mirroring
`data/simbad/wds_xids_overrides.tsv`: keyed on **SID** (frozen identity,
survives re-indexing, and a no-Gaia record has no source_id), columns
`sid`, `display_name`, `reason`, `source`. Applied after SID resolution,
before the name table is written; every row is a reviewable diff.

Expected to stay near-empty. It exists for review findings the authority
cannot express — not as a home for folk names § 2 routes to aliases. A
growing override file is a signal the ingest is wrong, and its row count is
pinned in build-counts so growth is visible in review.

## 8. Parity — the gate on any naming change

A **naming parity ledger**, same discipline as `docs/catalog-driver.md` § 6,
committed as a test fixture:

1. **Searchability never regresses.** Every string that resolves a star
   today still resolves the same star. A displaced name becomes an alias or
   the gate fails. This is the hard invariant.
2. **Display changes are enumerated, not counted.** Every record whose
   displayed name changes appears with old name, new name, and the tier that
   won. Reviewed once, then pinned.
3. **Tier routing counts pinned** in build-counts: records named per tier,
   IAU names matched / unmatched / unreachable, override rows, alias count,
   and the § 2 residual classes.
4. **`KNOWN_DUPLICATE_DISPLAY_NAMES` → 0** (`stellata-wgp3.4`). Two of
   today's three duplicates dissolve here: `p Eridani` ×2 becomes
   `p Eri A` / `p Eri B` per the authority, and `The-1 Ori Cb` /
   `The-1 Ori E` become correctly-rendered θ¹ Ori forms. The residual
   cross-root Trapezium collision is a WDS rooting defect, not a naming one
   — the composer must be injective given (system root, component letter),
   and a surviving collision is a data finding, never a renderer concession.
5. The frozen corpora (known-stars, sky-position, multi-star-regression)
   stay green; `known-stars.test.ts` is where a famous star silently losing
   its name surfaces.

## 9. What each child does

- **`stellata-wgp3.2`** — ingest `NEC.csv` + `wgsnFaints.csv` to
  `data/iau-wgsn/` (frozen, `data/README.md` § Frozen external data steps
  1–5, refresh helper under `scripts/refresh/`), both normalisers, the
  keyed name + designation tables, the § 2 residual list, counts.
- **`stellata-wgp3.3`** — the composer module + ladder, the `SearchEntry`
  shape of § 4, the name-table rewrite, retirement of the 536 ASCII
  composites and of runtime Bayer-string parsing.
- **`stellata-wgp3.4`** — duplicates to 0 on top of the composer.
- **`stellata-jel8.6`** — chart-mode glyph rendering + system-level
  designation preference; falls out of the composer, keeps its own smoke.

Sequencing note: the ladder is independent of the driver swap
(`stellata-3bsf.4`) — it reads designations, whichever source produced them
— but its Bayer/Flamsteed tail and every label's spine backstop come from
`data/athyg/inherited-spine.tsv`, which is why the ingest keys HIP/HR/HD and
never `gaia_source_id` alone: **115 of the 178 stars at V ≤ 3 have no
source_id-keyed overlay row** (`data/classic-ids/README.md` § Coverage), and
those are exactly the stars the authority names.

**Dead patterns — do not rebuild:** composing a display string anywhere but
the composer; storing an ASCII Bayer convention as the canonical form;
parsing a Bayer string at runtime; rendering a designation against the
positional constellation; a curated table of folk names; an "also known as"
UI surface (a displaced string is either a designation, and belongs on the
identity line, or an invention, and belongs only in the alias index).
