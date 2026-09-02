# Typeahead pickers

Star + constellation pickers. Used by the search row (top-right) and
the Constellation row in the panel; also re-used by the `G` / `C`
keyboard-shortcut modals via DOM relocation (the same widget
elements are moved into the modal on open and restored on close).

## Star search

Two leaves sit below `search.ts` so the star kind module's provider
chain can import them without a cycle through `search.ts` →
`kind-modules.ts`. `search.ts` re-exports both, so either import path
stays valid.

- `star-designations.ts` — pure per-entry designation formatters
  (`splitBayer`, `formatBayerDisplay`, `superscript`,
  `formatGcvsDesignation`, `starDesignations`).
- `star-name-tables.ts` — the per-catalog derived maps
  (`buildStarLabels`, `buildSpectralMap`, `buildBayerMap`). The star
  module builds the first two inside its own `load`; `buildBayerMap` is
  the one derivation no module consumes, so boot still calls it for
  chart mode.

`search.ts` is fuse.js-backed; ranks against name + constellation +
Bayer designation. Every constellation-relative *designation* — Bayer,
Flamsteed, GCVS, the component aliases below — resolves through
`designationConIndex(entry.dc, entry.c)`, never `entry.c` alone: byte 34
is where the star *is*, `dc` is what its name is *named for*, and the two
diverge on ten entries (`scripts/catalog/README.md` § Search index). The
dropdown's context line is the reverse — positional `c`, so a row reads
the constellation the star sits in. Selecting an entry dispatches through `flyTo` /
`focusStar` for navigate or `warpTo` when picking a location in
observe mode.

`createSearchRunner` is the shared query runner (ID dispatch + fuzzy +
tier re-rank + within-kind dedup over stars + Sol's planets + every
kind-module row — clouds, Local Group objects, boundary shells, and
the deep-space probes arrive via each module's `searchEntries()` leg,
so the runner takes no per-kind parameters). Fuzzy hits re-rank at equal (bucketed) Fuse score: exact
label > query-is-prefix > plain name/alias > constellation-expansion
label ("Gamma Andromeda" — fuzzy-searchable but never outranking the
Andromeda Galaxy for the bare constellation-name query), then shorter
label wins. Fuse runs with `ignoreFieldNorm` (token-count norm would
outvote the tiers) and no result cap (the corpus-tail LG entries
would be evicted from any pre-rank pool by score-then-insertion
ordering). All three star-corpus boxes debounce keystrokes by
`SEARCH_DEBOUNCE_MS` (250 ms trailing, `typeahead-util.ts`) — the
fuzzy scan costs 40–170 ms and synchronous per-keystroke it stalls
typing; Enter flushes a pending query first, so fast-type-then-enter
selects against the full text. The constellation picker stays
synchronous (cheap substring filter). LG
entries index the display name plus every build-emitted alias
("Andromeda Galaxy", "M31", "NGC 224", …), plus the Messier spellings
`designationVariants` regenerates for each of those ("M 31", "Messier
31") — the catalog stores one conventional form per designation, so the
variants exist only in the corpus; the dropdown secondary
line is the morphological type alone. **No row carries a
distance-from-Sol** — that reading belongs to the distance vector, the
POI marker, and the focus card, and an LG-only distance made the one
kind whose secondary line read differently from every other. The type
is what disambiguates a "Sagittarius" dSph hit from the star rows,
whose secondary line is their constellation. The two boundary shells (Local Bubble, heliopause) enter the corpus by
name, secondary line = their type descriptor, index = the `SHELL_KEYS`
Target idx. Sol's planets and moons enter the corpus
by name (secondary line "Planet · Sol system" or "Moon · <parent>") —
deliberately Sol-only, since bk5 exoplanets are visit-to-discover. A
planet entry carries the body field's flat Target index, baked by the
planet module's `searchEntries()`; boot awaits `stellata.kinds.planet.systemsReady`
before binding search so the attach table exists at corpus build.
**The corpus is a boot-time snapshot** — the rows hold flat indices,
not a live lookup, and `resolveEntryTarget` is a plain `{kind, idx}`
wrap with no attach-table check behind it. Sol is the only host that
ever attaches today, so nothing can go stale; the bk5 exoplanet phase,
which attaches hosts on approach, has to rebuild the corpus on attach
rather than extend this one.
The five deep-space probes enter by mission label, secondary line
"Probe · Interstellar", index = the LOADED-roster index, which is the
Target idx directly (no translation) — so a probe whose artifact is
missing is absent from the corpus rather than shifting the others.
Focus-box select dispatches to
`flyTo` and the To box to `setVector`, each with the entry's
kind-tagged Target; observe mode filters SOFT kinds out of the location
picker through `isHardTarget`, never a spelled-out kind list. Both the topbar boxes
(`bindSearch`) and the `F` find picker (`bindFindSearch`) run it, so
ranking never diverges between them. The find picker differs only in its
`onSelect`: it resolves the pick to a local position and calls
`stellata.aimAt` — pointing the camera without focus, warp, or travel —
and its widget is relocated into the shared `#kb-modal` card by the
keyboard-shortcut handler (see `../ui/README.md` § Keyboard shortcuts).

GCVS variable-star designations (`g` field: `R CrB`, `VY CMa`, `V645 Cen`)
are Fuse-fuzzy like Bayer/proper names — `buildGcvsLabels` emits both the
abbreviated and con-name-expanded forms, and `formatGcvsDesignation`
strips the V-number zero-padding GCVS stores (`V0645` → `V645`; anchored
at the start, so `LMC V0471` keeps its zeros). A variable with no
proper/Bayer/Flamsteed name (VY CMa, RR Lyr) takes its GCVS designation
as its display label via `buildStarLabels`.

**The expansion is gated on the trailing token BEING the entry's
constellation code**, not on the entry having a constellation. 6,079 of
the 14,148 GCVS-named entries end in something else — NSV serials
(`NSV 04199`) and Magellanic field numbers (`LMC V0471`) — and rewriting
that token emitted "NSV Lupus" / "LMC Dorado": a designation that does not
exist, in a constellation the number has nothing to do with. Gating on the
entry's own code rather than on "is some IAU abbreviation" is equivalent
today (zero entries disagree, since `desigConIndex` is set *from* the
designation) and stays correct if they ever diverge.

**Multiple-star component aliases.** A component whose SearchEntry carries
`cl` (WDS letter) + `cp` (system-primary record index) gets extra fuzzy
labels "<system designation> <letter>" — "α Cen C" / "Alpha Centaurus C" /
"Alf Cen C" all focus Proxima, and "Alpha Cen A"/"B" the right members.
`buildComponentLabels` expands them by running the PRIMARY's Bayer through
`buildBayerLabels` (shared Greek/Alf expansion) plus its Flamsteed form,
then appending the letter. Base comes from the primary because a component
often has no Bayer of its own (Proxima); proper names are excluded on
purpose — the primary's proper (Rigil Kentaurus) names component A, not the
system. `cl`/`cp` are emitted at build time (see `scripts/catalog/README.md`
§ Search index); coverage is whatever decomposes in `multiples.tsv`.

`starDesignations` (pure, tested) renders a star's full tier-ordered
designation list (proper → Bayer → Flamsteed → GCVS → HR → HD → HIP →
Gliese → Gaia DR3) for the focus card's identity line. **The HR and HD tiers
list every number the record answers to**, `hra` / `hda` beside the displayed
value in numeric order: an alias rides a record only where the pair is
unresolved, so that one record is what both catalogue numbers reach, and a card
showing one of them would deny a number the search box had just accepted. Bayer-form GCVS
designations ("bet Per") are skipped — they duplicate the real Bayer
display and are search aliases, not display names.

Beyond the index-backed ID forms, the runner dispatches two
catalog-wide exact-match forms with lazily-built lookup maps (no
search-index bloat): `Gaia <id>` / `Gaia DR3 <id>` / a bare 19-digit
source_id, and `SID <n>` / `SID #<n>` (the frozen Stellata ID) — so
every star an identifier-less card labels "Gaia DR3 …" or
"Unnamed (SID #…)" is typeable back into search.

`buildSearchIndex` (pure, tested) builds both the fuzzy corpus and the
exact direct-lookup maps for numeric IDs (HIP/HD/HR/Gl) and Flamsteed.
The numeric-ID maps echo the matched identifier in the dropdown
("Vega (HIP 91262)") — though a star with no proper name has nothing to echo
*against*, so its row reads as the bare identifier the user typed.

`hdMap` / `hrMap` are many-keys-to-one-record rather than 1:1, built by
`buildAliasedIdIndex` (`scripts/catalog/catalog-pure.ts`) rather than inline:
numbers records DISPLAY are laid down first, then the `hda` / `hra` aliases,
first write winning. That one rule settles two collisions — 57 HD and 11 HR
numbers are displayed by two records each (a component pair sharing one
catalogue number), and entries arrive brightest-first, so an ambiguous number
resolves to the brighter record; and an alias never displaces a record that
displays that number outright. `catalog-lookup.ts`'s `byHd` uses the same
builder, so a frozen corpus row and the search box cannot resolve one number
differently. Which numbers become aliases at all is the write side's rule
(`scripts/catalog/classic-ids/README.md` § An alias stops at the blend): only
where the pair is unresolved, so the record carries both components' light.
The direction the dropdown reads — record to label — stays single-valued.

The Flamsteed map keys `<num> <con>` to
**an array** of every component sharing that designation, so an exact
"61 Cyg" returns each of 61 Cyg A/B/… with its own display name —
never collapsed to one, never echoing the raw query. Anonymous
Flamsteed stars (no proper name, no Bayer) display the canonical
"<num> <Con>" designation.

## Constellation typeahead

`constellation-typeahead.ts` replaces the old `<select id="con-select">`
with an `<input id="con-input">` + dropdown. Substring filter against
constellation name plus 3-letter IAU code; full alphabetised list shows
when the input is empty and focused. Single-select — picking fires
both `setFilter({ highlightCon })` and `aimAtConstellation`, matching
the prior `<select>` behaviour. Reverse-sync from the `'filter'` event
keeps the input in step with URL restores.

A synthetic `NONE_ENTRY` (`idx: -1`, `search: ''`) is prepended to the
results whenever the input is empty, so users can clear the highlight
by selecting "None" the same way they'd pick any other constellation
(Cmd+A → Delete → Enter). The empty `search` field keeps it out of
filtered results so it can't outrank a real match. `pick()` skips
`aimAtConstellation` when `idx < 0` so the clear path doesn't try to
aim at a non-existent target.

**No master toggle.** There used to be a `#show-constellation` checkbox
gating the whole constellation overlay, with a double-tap `C` flipping it.
Both are retired: the declutter cycle already owns whether constellation
chrome draws, via the `constellationFigures` / `constellationBoundaries`
floors (`../scene/README.md`), so a second switch was a redundant answer to
the same question. The picker is therefore always enabled, and `C` is a
plain single press with no deferral window.

`highlightCon` survives and means only *which* figure is picked. URL flag
bit 7 (the old `FLAG_CON_DISABLED`) is retired to decode-and-ignore —
`../util/url-state/README.md`.
