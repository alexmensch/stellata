# Naming — the authority ladder, its ingest, and the display-name composer

Everything that decides what a star is CALLED: the IAU WGSN ingest, the
designation normalisers, and the build's half of the display-name composer.
The composer itself turns a record's structured designation set into the
string the app shows, and the viewer runs it too, so it lives in
[`/src/catalog-format/naming/`](/src/catalog-format/naming/README.md) with
the Greek spellings it reads. The contract is `docs/star-naming.md`.

Two entry points regenerate committed artifacts, both asserted
byte-identical in CI so artifact and code always land together:

- `pnpm run build:wgsn` — the keyed tables under `data/iau-wgsn/`.
- `pnpm run build:naming-parity` — the parity ledger ([The parity ledger](#the-parity-ledger)).

`build:catalog` calls this folder in two phases
([Record phases](../record/README.md#record-phases)): `applyStarNames` on the
walked records (`../stages/naming-stage.ts`), and `assignDisplayNames` on the
sorted ones once their SIDs are allocated (`../stages/finalise-stage.ts`). Its
display names ride the finalised catalogue, never a record.

## Files in this area

```
scripts/catalog/naming/
  wgsn-nec-source.ts            WGSN_NEC and WGSN_FAINTS, declared
  wgsn-faints-source.ts         (../../util/sources/); the faints source
                                applies its curated corrections file, a
                                member of the declaration.
  wgsn-parse-pure.ts (+ test)   NEC.csv / wgsnFaints.csv parsers — comma
                                CSV with quoted cells, split through
                                ../../util/tsv/'s splitCsvLine against a
                                fixed header; null spellings `_` / `~` / `-` /
                                `null`, and both key columns' inline
                                component letters (`HIP 518A`, `62264AB`).
                                A key shape covered by neither throws, and
                                so does a Vmag that is not a decimal; the
                                faints file's reader of
                                data/iau-wgsn/wgsn_faints_corrections.tsv
                                sets its three G-in-V cells first.
                                Both headers and the null spellings are
                                also refresh:iau-wgsn's gates
                                (../../refresh/iau-wgsn/).
  wgsn-normalise-pure.ts        Both /docs/star-naming.md#4-canonical-designation-forms normalisers. NEC `Bayer/other`
    (+ test)                    grammar → structured bayer / flamsteed /
                                gould / variable / non-stellar /
                                other-catalogue / corrupt; IV/27A `bayer`
                                cells → glyph + superscript, with the GCVS
                                contaminants rejected to the variable
                                class; V/50 `name` cells' Bayer field, read
                                as an IV/27A cell. Plus the multi-name cell split and
                                the diacritic fold used for name matching.
  wgsn-tables-pure.ts (+ test)  Row shaping, the Bayer tail union (IV/27A,
                                then V/50), the key sets it reaches by, and
                                the total sort order the committed table's
                                byte-for-byte CI diff rests on.
  build-wgsn-tables.ts          Orchestrator: read, normalise, delegate
                                the joins, and emit the two derived
                                tables through emitArtifacts once the
                                count snapshot passes.
  wgsn-names-tsv.ts             WGSN_NAMES / WGSN_DESIGNATIONS — the two
  wgsn-designations-tsv.ts      derived tables' artifact codecs
    (+ wgsn-tables-tsv.test)    (../../util/tsv/README.md#artifact-codecs).
                                Designation rows sort by
                                compareDesignationRows.
  wgsn-tables-outputs.ts        WGSN_OUTPUTS — the two derived tables as
                                build:wgsn's emitArtifacts declaration
                                (../../util/README.md). Both it and the
                                codecs take the paths from DATA_FILES
                                (/src/catalog-format/pipeline-outputs/).
                                Side-effect free.
  wgsn-expected.json            Pinned count snapshot
                                (--update-snapshots refreshes),
  wgsn-expected-json.ts         declared as WGSN_COUNTS
                                (../../util/sources/README.md#a-snapshot).
  wgsn-index-pure.ts (+ test)   The record-side join: the keyed index and
                                the three pickers (#the-record-side-join).
  string-designations-pure.ts   The names no WGSN row approves
    (+ test)                    (#string-designations): the cited-eponym,
                                dropped-name and short-form readers, the
                                record join by identifier, the ident
                                match, and the reach check the membership
                                gate test runs.
  string-designations.test.ts   Every committed eponym's citation, checked
                                against simbad_idents.tsv or the WGSN
                                Gould rows.
  apply-star-names.ts           I/O + the record pass: loads the committed
    (+ test)                    tables and IV/27A's designation
                                constellations (../classic-ids/), and
                                attaches each record's authority
                                tiers, eponym, aliases and designation
                                constellation.
  string-designations-source.ts EPONYMS, NAME_DROPS, NAME_OVERRIDES,
  name-overrides-source.ts      BAYER_DROPS and SIMBAD_SHORT_FORMS, the
  bayer-drops-source.ts         curated tables under data/naming/,
  simbad-short-forms-source.ts  declared (../../util/sources/); only the
                                citation test reads the short forms.
  display-names.ts (+ test)     The build's half of the composer: every
                                record's designation set → its naming
                                outcome (`NamedRecord`), with the NAME
                                tiers as the name table's strings
                                (`displayNames`, per record), and
                                NamingDerivedCounts, the naming-derived
                                block. Also the curated override's join,
                                which hard-fails on an unmatched SID.
  naming-lineage-pure.ts        The display-name pass as a lineage stage:
    (+ test)                    its reason codes, the serialiser over
                                each record's naming outcome, and its
                                count block's log line
                                (#naming-lineage).
  naming-parity-pure.ts         Ledger row types, the record-identity key
                                and the shared label resolver.
  naming-parity-tsv.ts          NAMING_PARITY / NAMING_DUPLICATES — the
  naming-duplicates-tsv.ts      two ledgers' artifact codecs, sorted by
    (+ naming-ledgers-tsv.test) key and by label.
  committed-artifacts.test.ts   serialize(parse(committed)) === committed
                                for all four artifacts this folder writes.
  built-labels.ts               builtLabels: every built record's label,
                                off the naming lineage, by record index.
  build-naming-parity.ts        Refreshes the ledger and the duplicate
                                list from the built artifacts, both in
                                one emitArtifacts call.
  naming-parity-outputs.ts      NAMING_PARITY_OUTPUTS — the ledger and the
                                duplicate list, as build:naming-parity's
                                emitArtifacts declaration. Side-effect free.
  naming-parity.test.ts         The /docs/star-naming.md#8-parity--the-gate-on-any-naming-change gate over the built artifacts.
  naming-parity.tsv             The display-change enumeration.
  naming-duplicates.tsv         Duplicate composed labels — data findings.
```

## The union policy

WGSN is the primary designation source; IV/27A and then V/50 supply only
the Bayer tail — a tail row is added only when no Bayer row above it
already reaches its star by HIP, HR or HD (IV/27A: <!-- count:wgsn/iv27aBayerCovered -->1,605<!-- /count --> covered, <!-- count:wgsn/iv27aBayerAdded -->444<!-- /count -->
added; V/50: <!-- count:wgsn/v50BayerCovered -->1,563<!-- /count --> covered, <!-- count:wgsn/v50BayerAdded -->1<!-- /count --> added, π¹ Cnc). V/50's `name` cell
prints no HIP, so its row reaches through the HIP IV/27A links its HD to;
that link is what keeps ξ UMa off the B component, whose HD 98230 V/50
also labels ξ. IV/27A Flamsteed numbers are **not** unioned: the record build
already carries `f` via the label merge and `dc` via the
designation-constellation cascade, and the cross index adds no glyph
content to them.

Classes that emit no designation row, all pinned: `variable` routes to
the GCVS tier (tier 6 sources it from GCVS itself — <!-- count:wgsn/cellVariable -->615<!-- /count --> WGSN cells + <!-- count:wgsn/iv27aVariableRejected -->134<!-- /count -->
IV/27A contaminants), `non_stellar` (clusters / nebulae / galaxies, <!-- count:wgsn/cellNonStellar -->132<!-- /count -->),
`other_catalogue` (BD / CD / Gliese / survey ids, <!-- count:wgsn/cellOtherCatalogue -->95<!-- /count -->), `corrupt` (the
ρ² Ara Mathematica artifact, <!-- count:wgsn/cellCorrupt -->1<!-- /count -->).

A two-capital head reads as GCVS **before** the Greek lookup, which is
case-insensitive over the ASCII abbreviations: `NU Pav` is the M6III
semiregular variable (HD 189124), and reading it as Greek minted a second
ν Pav onto it (the Bayer star ν Pav is HD 169978).

`other_catalogue` normally costs nothing because the star still keys by
HIP / HR / HD, with one exception worth knowing: **<!-- count:wgsn/namesKeyless -->53<!-- /count --> of the <!-- count:wgsn/namedRows -->509<!-- /count --> approved
names have no HIP, HR or HD at all** (`namesKeyless`). They are wgsnFaints
exoplanet hosts whose only identifier is the survey id in the dropped cell
— `WASP-32`, `HAT-P-29` — and the file's WDS column, which would otherwise
root them, is empty in every row (`faintsWdsCells`, pinned at <!-- count:wgsn/faintsWdsCells -->0<!-- /count -->).
Positionally, all but one sit outside the membership manifest entirely, so
they name stars the catalogue does not carry; the pins are there to catch a
refresh that changes either fact.

## String designations

A name no WGSN row approves reaches a record only through
`data/naming/`, keyed on an identifier the record holds (`hd:` / `hip:` /
`gaia:`), never on a name string:

- **`eponyms.tsv`** — the discovery, catalogue and Gould designations the
  ladder displays as strings (`Ross 128`, `Cygnus X-1`, `82 G. Eri`), each
  citing its source: a SIMBAD object and the ident that spells it, or the
  authority's own Gould row. 22 cite SIMBAD, 1 cites WGSN.
- **`name_drops.tsv`** — the names no source attests, each with its
  evidence. They ship as search-only aliases and never display, so a string
  that resolved a star still resolves it
  ([§ 8.1](/docs/star-naming.md#81-searchability-never-regresses)): 10
  unattributed folk names; the 2 `p Eridani` genitives (the Bayer tier
  renders `p Eri`, and the full genitive is not derivable from it);
  Groombridge 1830, 268 G. Cet and 96 G. Psc, which neither SIMBAD nor the
  authority carries; and 5 IAU names with a component letter (`Cor Caroli B`)
  whose record displays its own Bayer label, so nothing composes the string.
  The other 3 such names (`Revati B`) compose: the component borrows its
  system's name.

**An ident attests a name when, spelt out, it equals the name** up to spacing
and case. `simbad_short_forms.tsv` spells SIMBAD's catalogue codes out
(`LAL` → `Lalande`, `** STF` → `Struve`) and drops its class markers (`NAME`,
`V*`); an ident no short form covers attests nothing. A system ident with a
component suffix attests a name that carries no letter — `** KR 60AB` is
`Kruger 60` — and never a different component: `** STF 2398A` does not
attest `Struve 2398 B`. `string-designations.test.ts` checks every citation
against the committed `simbad_idents.tsv`, and that every short form is cited.

**Each row reaches exactly one record, and never one the authority names.**
`membership-manifest-gate.test.ts` holds it over the manifest, so a WGSN
refresh that approves a name fails there until the row is deleted, and a
membership change that moves its key fails until the key follows.

## Measured coverage

The unioned table reaches **<!-- count:build-catalog/namingBayer -->2,044<!-- /count -->** records. The Bayer cells AT-HYG printed
that it reaches no record with are the rows of `data/naming/bayer_drops.tsv`,
each frozen with its reason: one today, ξ UMa on HD 98230, `sibling_holds`
(the authority keys ξ UMa on the A record, so B takes the system's
designation with its component letter). The membership gate holds every
row to a record the Bayer join leaves bare.

Three designation rows carry no key at all (`designationsKeyless`):
β Cen B, δ Cyg B and ζ Her B spell both key cells `-` upstream. Seven
rows tie on every field (`designationDuplicateRows`), and seven name rows
repeat a name against the same keys (`nameDuplicateRows`) — NEC lists the
components of a close pair as separate serials, so Talitha, Acrab, Sabik
and the rest arrive twice. Neither table dedupes; the pickers below do.

## The record-side join

`wgsn-index-pure.ts` answers, per record, which approved name and which
glyph-bearing designations reach it. Three things in it are easy to get
wrong, and each cost a wrong name before it was pinned:

**The key order is HR → HD → HIP.** Hipparcos resolved close pairs as ONE
star, so its number is the least component-specific of the three: NEC
lists both p Eri rows against HIP 7751 and separates them only by HR
(486 / 487) and HD (10360 / 10361). A HIP-first join collapses p Eri A and
B onto one record — the very duplicate [§ 8](/docs/star-naming.md#8-parity--the-gate-on-any-naming-change) expects
the ladder to dissolve. [§ 3](/docs/star-naming.md#3-the-ladder) states HIP first and is
wrong; the order here is the measured one.

**An ambiguous number is not a key.** The join reads a record's
single-valued `hd` / `hr` only, never its `hdAlt` / `hrAlt`: an ambiguous
designation names a catalogue granularity (`../classic-ids/README.md`
label-merge/README.md), and joining through one attached another component's
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

**The names the NAME picker passes over ship as aliases**, with every
reaching row's published alternates (`Bake Eo`), less any passed-over name
carrying a component letter: NEC lists σ CMa as both `Unurgunite` and `Nganurganity`, and the
picker displays the first while the second stays searchable. `Albireo A`
names a component, so it does not ride on Albireo.

**Three approved names reach no record by identifier**, so the curated
override table carries them by SID (`data/naming/name_overrides.tsv`):
Albireo B, whose record is HD 183914 against the authority's 183913, and the
faints hosts Kaewkosin and Maru, whose authority rows carry no identifier the
records hold. Sol carries `SOL_PROPER_NAME`: no catalogue names it.

## The designation constellation

The authority states which constellation its own designation is named for,
so `applyStarNames` writes it as the top tier of the cascade the label
merge started ([The designation constellation](../classic-ids/README.md#the-designation-constellation)),
so <!-- count:build-catalog/naming.dc.wgsn-bayer -->2,044<!-- /count --> records render against the constellation of the
authority's Bayer designation and <!-- count:build-catalog/naming.dc.wgsn-gould -->936<!-- /count --> against its Gould one. One
`uint8` serves one designation and the tier that COMPOSES the label owns
it, so where the authority's Bayer names a different constellation from
the record's Flamsteed number — 16 Lyn is also ψ¹⁰ Aur,
`naming.dc.displaced` pins <!-- count:build-catalog/naming.dc.displaced -->2<!-- /count --> — the displaced Flamsteed form ships as an
alias rather than going unsearchable.

## The parity ledger

[§ 8](/docs/star-naming.md#8-parity--the-gate-on-any-naming-change), as two committed TSVs plus
`naming-parity.test.ts`:

- **`naming-parity.tsv`** — one row per record whose displayed name changed
  when the ladder landed: `key` (the same gaia → hip → synth identity the
  runtime binaries loader resolves records through), `old`, `new`, and
  `resolves`. The `old` column is FROZEN: it is the string a user could
  have typed, and `resolves` records whether it still reaches that record.
  A record the catalogue no longer carries reads `resolves = absent` with
  an empty `new`; an empty `new` on a `yes` / `no` row is a record that now
  displays the runtime's identifier fallback. 3,685 changes: 12 absent
  records, 76 fallbacks. `absent` is read off the frozen key, so a record
  that gains a Gaia binding after its row was seeded reads `absent` under
  its old `hip:` key while the catalogue still carries it (λ Equ,
  107 Aqr A, 59 G. Cet, τ Scl A, γ¹ CrA, θ¹ Ori A, L² Pup).
- **`naming-duplicates.tsv`** — every display label two or more records
  compose, with its claimants. A RATCHET: each row is a curation finding
  upstream, and `../../../tests/integration/multi-star-regression.test.ts` additionally
  refuses any within-one-WDS-root duplicate this file does not enumerate.

The gate is stated over strings with EXTERNAL provenance — every name the
authority approves and every name the manifest carries must reach a record.
A string the build composed itself has no external existence, so [§ 5](/docs/star-naming.md#5-aliases--ship-what-cannot-be-derived-derive-what-can) lets
it disappear with the composition that made it; 1,976 do, and the ledger's
`resolves` column is where each one is reviewable.

`pnpm run build:naming-parity` refreshes `new`, `resolves` and the
duplicate list, and prints the figures above. `new` and the duplicates are
a view of the [naming lineage](#naming-lineage): `builtLabels` reads each
record's label off its name row, joined to its record index through its
SID (`allocation.sids` and catalog.bin's SID column), so no reader
re-composes a label. `resolves` asks the search corpus.
`naming-parity.test.ts` reads the same labels, and checks that the runtime's
composition off `search-index.json` reaches every one of them. `key` and `old` carry forward from
the committed file; `NAMING_PARITY_SEED=<key/old TSV>` re-seeds them, which
is what a deliberate wholesale naming change needs and nothing else should
touch.

## Naming lineage

The display-name pass is the last stage of the [lineage](../lineage/README.md)
contract (`naming-lineage-pure.ts`), after SID allocation, since the curated
override keys on SIDs. `namingLineageRows` serialises each record's
`NamedRecord` through an exhaustive `switch`:

- every record gets one name row: `name.own.<tier>` (the highest tier it
  carries), `name.borrowed.<rule>.<tier>` naming the borrowing rule that
  fired and the anchor's tier, or `name.unlabelled`, where the runtime's
  Gaia DR3 / SID fallback takes over. The tier is the ladder's, kebab-cased
  (`bayer-latin`), so the count block folds each tier from its codes.
  `params` carry the label; a borrowed row names its anchor by
  origin key (`params.anchor`) and its component letter;
- each other tier the record carries is a `refused` row: `name.lower-tier`
  below an own label, `name.borrowed-over` for a borrowed one;
- a lettered label adds its letter's source: `letter.stated` (the authority's
  attribution), `letter.sibling-owns`, or `letter.borrowed`;
- a record carrying a Bayer, Flamsteed or Gould designation adds the
  constellation it renders against: the cascade tier that wrote it
  (`desigCon`, [The designation constellation](../classic-ids/README.md#the-designation-constellation)),
  `dc.positional` or `dc.none` (pinned at zero rows by `NAMING_INVARIANTS`,
  [Invariants](../lineage/README.md#invariants)), and a `refused` `dc.displaced` row for the
  IV/27A constellation an authority tier overwrote.

The stage founds no record, so it writes no identity rows, and every code's
effect is `none`.

Its snapshot stage `naming` is its lines folded per live code
([Counts fold from lineage](../lineage/README.md#counts-fold-from-lineage)),
beside `applyStarNames`' tally (`StarNamingCounts`), which has no codes
and keeps its `naming*` keys. A per-tier figure is a sum of the tier's
`name.own` and `name.borrowed` codes. `naming-derived` holds what no one
record decides: the duplicate labels, the curated override rows applied
and the name table's entries.

Measured 2026-11-05: 1,017,955 rows, one name row per record plus its refused
tiers, letter and designation constellation (78 MB plain), 9.7 MB gzipped in
2.7 s without a diff; `NAMING_LINEAGE_BUDGET` pins 10.6 MB and 28 s: a CI run
with a diff, building the lines inside the window, took 18.9 s (2026-11-08).
