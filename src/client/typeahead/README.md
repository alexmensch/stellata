# Typeahead pickers

Star + constellation pickers. Used by the search row (top-right) and
the Constellation row in the panel; also re-used by the `G` / `C`
keyboard-shortcut modals via DOM relocation (the same widget
elements are moved into the modal on open and restored on close).

## Star search

`search.ts` is fuse.js-backed; ranks against name + constellation +
Bayer designation. Selecting an entry dispatches through
`focusStar(idx)` for navigate or `warpTo(idx)` when the To slot is
active.

`createSearchRunner` is the shared query runner (ID dispatch + fuzzy +
within-kind dedup over stars + clouds). Both the topbar boxes
(`bindSearch`) and the `F` find picker (`bindFindSearch`) run it, so
ranking never diverges between them. The find picker differs only in its
`onSelect`: it resolves the pick to a local position and calls
`stellata.aimAt` — pointing the camera without focus, warp, or travel —
and its widget is relocated into the shared `#kb-modal` card by the
keyboard-shortcut handler (see `../ui/README.md` § Keyboard shortcuts).

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
