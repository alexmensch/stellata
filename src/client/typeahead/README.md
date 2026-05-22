# Typeahead pickers

Star + constellation pickers. Used by the search row (top-right) and
the Constellation row in the panel; also re-used by the `G` / `C`
keyboard-shortcut modals via DOM relocation (see
`src/client/ui/README.md` § Go / Constellation pickers — DOM
relocation).

## Star search

`search.ts` is fuse.js-backed; ranks against name + constellation +
Bayer designation. Selecting an entry dispatches through
`focusStar(idx)` for navigate or `warpTo(idx)` when the To slot is
active.

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
