# Typeahead pickers

Star + constellation pickers. Used by the search row (top-right) and
the Constellation row in the panel; also re-used by the `G` / `C`
keyboard-shortcut modals via DOM relocation (the same widget
elements are moved into the modal on open and restored on close).

## Star search

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
tier re-rank + within-kind dedup over stars + clouds + Local Group
objects + Sol's planets + boundary shells + the deep-space probes). Fuzzy hits re-rank at equal (bucketed) Fuse score: exact
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
("Andromeda Galaxy", "NGC 224", "M 110", …); the dropdown secondary
line carries morphological type + distance (kpc/Mpc) so "Sagittarius"
disambiguates the dSph from star rows. The two boundary shells (Local Bubble, heliopause) enter the corpus by
name, secondary line = their type descriptor, index = the `SHELL_KEYS`
Target idx. Sol's planets and moons enter the corpus
by name (secondary line "Planet · Sol system" or "Moon · <parent>") —
deliberately Sol-only, since bk5 exoplanets are visit-to-discover. A
planet entry carries the SOL_BODIES body-within-host index (planets then
moons); `resolveEntryTarget` translates it to the body field's flat
Target index at pick time (the field attaches on a microtask after boot).
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
strips the V-number zero-padding GCVS stores (`V0645` → `V645`). A
variable with no proper/Bayer/Flamsteed name (VY CMa, RR Lyr) takes its
GCVS designation as its display label via `buildStarLabels`.

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
Gliese → Gaia DR3) for the focus card's identity line. Bayer-form GCVS
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
The numeric-ID maps are 1:1 and echo the matched identifier in the
dropdown ("Vega (HIP 91262)"). The Flamsteed map keys `<num> <con>` to
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

**Master toggle (`showConstellation`).** A `<input id="show-constellation">`
checkbox at the top of the Overlays group gates the entire constellation
overlay — both the highlighted-only-in-navigate and the all-at-once
chart-mode pass, plus the chart-mode Latin-name labels. When off,
`controls.ts` disables `#con-input` and adds `.disabled` to `#con-picker`
(faded sub-label), and a single `C` keypress is a no-op. A **double-tap
on `C`** flips the master toggle in either direction — single taps are
deferred by `C_DOUBLE_TAP_MS` (200 ms) so a second press inside the
window can intercept the picker-open and switch to the toggle action.
Key repeat (held key) is ignored so the flag doesn't oscillate.
`highlightCon` is preserved while disabled, so re-enabling restores
the prior selection. URL flag bit 7 (`FLAG_CON_DISABLED`) encodes the
off state; default (on) is implicit.
