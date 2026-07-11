# UI and panel

The right-side settings panel, layout containers, keyboard shortcuts,
magnitude / FOV / exaggeration / theme controls, scale bar, and CSS
gotchas.

## Keyboard shortcuts

`keyboard-shortcuts.ts` owns a single `keydown` listener and dispatches
to existing public APIs — every shortcut is a thin wrapper, so future
behavioural changes propagate automatically.

**Display metadata is separate from dispatch.** `keyboard-shortcuts-registry.ts`
holds the descriptor table (keys, label, `debug` flag). It's the single
source of truth for the `?` help modal (`../modals/help-modal.ts` renders
its `<dl>` from it), replacing the hand-authored list that used to live in
`index.html`. The keydown switch below stays the dispatch mechanism; the
registry only describes what to display.

| Key | Action |
| --- | --- |
| `G` | Open the Go picker — focus a star, set a destination, or change observe location |
| `F` | Open the Find picker — point the camera at any object without travelling to it (`aimAt`; observe mode only) |
| `O` | Switch to observe mode (gated on `getFocusedStar() !== null`) |
| `M` | Toggle chart mode (gated on `cameraMode === 'observe'`; auto-clears on observe→navigate) |
| `W` | Trigger the warp animation (handled by `warp-button.ts`, not this module) |
| `C` | Open the Constellation picker (double-tap toggles `showConstellation`) |
| `R` | Reset Camera-section sliders (size min/max, dynamic range, FOV, exaggeration) |
| `T` | Toggle the time scrubber (`../solar-system/time-scrubber-widget.ts`) |
| `←` / `→` | Time scrubber (while open): rewind / fast-forward — thin wrappers over the widget's `stepBack` / `stepForward` |
| `Space` | Time scrubber (while open): play / pause (`togglePlay`) — but during an active warp, Space skips the warp (`warp-button.ts`) and leaves the scrubber untouched |
| `Backspace` | Time scrubber (while open): reset to live now (`reset`) |
| `S` | Toggle `showGalacticGrid` |
| `H` | Toggle `showHud` |
| `F` `F` | Double-tap: toggle browser fullscreen (`fullscreen.ts`) — works in every mode. Single `F` opens Find in observe mode only (both are deferred by the double-tap window, like `C`). |
| `U` | Show/hide the top-right controls stack (`controls-hidden.ts`) |
| `+` / `-` | Magnitude limit ± 0.5 (clamped to [-2, 15]) |
| `=` | `applyMagnitudePreset('naked-eye')` |
| `?` | Open the keyboard-shortcuts help modal (the full shortcut list) |
| `Esc` | Priority chain below: modal close → cascade (observe→navigate → clear destination → clear focus) |

The Find picker reuses the shared search corpus via `createSearchRunner`
(`../typeahead/search.ts`) and is relocated into the `#kb-modal` card
like the Go / Constellation pickers — see § DOM relocation below.

**Capture phase.** The listener is registered with `{capture: true}`
because foreground-modal listeners (info / about / credits / help)
sit on `document` in bubble phase and flip `hidden=true` when ESC
fires. A bubble-phase window listener would observe the post-close
state and the cascade would run on top of the modal's own dismissal.
Capture lets us sample modal visibility *before* anyone else handles
the key.

**Modifier guard.** Shortcuts skip when `ctrlKey | metaKey | altKey`
is held so Cmd+R reload, Cmd+= zoom, etc. aren't intercepted. Shift
is fine — it's how `+` and `?` are typed on US layouts.

**ESC priority chain** (top of the keydown handler, before the
shortcut switch):

1. **Open kb-modal first.** The `Typeahead` class bails its own ESC
   when `results.length === 0` (e.g., an empty Go modal), so the
   shortcut module owns ESC for the kb-modal regardless of input
   focus. Closes both modals (idempotent) and `preventDefault`s.
2. **Other foreground modals** (`.modal`) — return without action so
   their own document listener can close them.
3. **Active warp** — return so `warp-button.ts` can run `skipWarp()`.
4. **Editable target** — return so `search.ts` / typeahead can handle
   their own ESC (clear dropdown + blur).
5. Otherwise run the cascade.

Fullscreen exit is not in this chain: the browser reserves Esc to
leave fullscreen and the exit is not cancelable by page code, so the
first Esc always leaves fullscreen (like any fullscreen web app). See
§ Fullscreen toggle.

### Go / Constellation pickers — DOM relocation

The two pickers reuse the existing `.search-wrap` (topbar) and
`#con-picker` (panel) widgets verbatim. On open, the live element is
moved into `#kb-modal-card` via `appendChild`; on close, it's restored
via `originalParent.insertBefore(widget, originalNextSibling)`. Event
listeners survive the move, so all `Typeahead` behaviour keeps working
unchanged — including OBSERVE-mode rerouting through `warpTo()`,
OBSERVE-only star filtering in `focusRunQuery`, and the None-entry
path in the constellation typeahead.

CSS-only relocation was tried first but rejected: the constellation
typeahead lives inside `data-group="overlays"` and `.panel-inner`,
both of which use `display: none` when collapsed. `display: none` on
an ancestor disables descendants regardless of their own `display`
or `position` — there's no CSS-only way to override it without
unhiding sibling content as well. DOM moves sidestep this entirely.

The Go picker's focus target depends on context: if `#search-to-row`
is visible (navigate mode with a focused star) the To input gets
focus; otherwise the Focus / Location input. `search.ts` already
toggles the row visibility per mode, so the modal automatically
mirrors what the panel would have shown.

### Close triggers

The shared `bindRelocateModal` helper closes on:

- ESC (handled in the shortcut module's capture-phase listener).
- Backdrop click (`.kb-modal-backdrop`).
- Input blur, deferred 180ms — covers `pick()`-then-blur (`Typeahead`
  blurs the input synchronously after `onSelect`), click-outside, and
  ESC inside the input. The 180ms sits just past `Typeahead`'s own
  140ms blur deferral so its result-mousedown race finishes first.
  An `onInputFocus` handler cancels the pending close, so re-focusing
  via the typeahead's X-clear button doesn't tear down the modal mid
  edit.

### Reset (R) scope

R resets only the four sliders under the panel's Camera section —
star size min/max, dynamic range, FOV, exaggeration — by calling the
same APIs that the per-row reset link buttons use:
`clearSizeOverrides(['sizeMin','sizeMax'])`, `clearSizeOverrides(['sizeSpan'])`,
`setCameraFov(DEFAULT_FOV)`, `setStarExaggerationK(getStarExaggerationKDefault())`.
Magnitude / focus / overlays / camera position are deliberately
*not* touched — those are user choices, not "default view" state.

## Per-group collapse in the settings panel

Two layers of collapse: the panel as a whole (top-level, key
`stellata.panel-collapsed`) and each `<section class="group"
data-group="...">` independently (key
`stellata.group-collapsed.<name>`). Both default to expanded;
both persist to `localStorage`. Wired in `panel-layout.ts`, whose
exported `bindCollapse` helper carries the header-click + persistence
pattern — the focus card (`../focus-card/README.md`) is the third
consumer. The
group header is the click target — `<header class="group-header">`
with an `<h3>` title and a chevron `<button class="group-toggle">`.
`.row-actions` (reset / all / none) live inside `.group-body`, not
the header, so their clicks don't bubble into the toggle.

## Disabled-control styling

`controls.ts` toggles native `.disabled` on inputs whose state is
preserved-but-frozen, and the panel CSS leans on the standard
`:disabled` selectors so each fade lives in one place:

- `.checkbox-row input[type="checkbox"]:not(:disabled):hover` — only
  *enabled* checkboxes pick up the hover border, so a disabled box
  doesn't look interactive.
- `.checkbox-row input[type="checkbox"]:disabled` — opacity 0.45 +
  muted border so the box itself reads as disabled (matches the
  faded label text).
- `.checkbox-row input[type="checkbox"]:disabled + span` — opacity
  0.55 on the label.
- `.con-typeahead input:disabled` + `#con-picker.disabled .sub-label`
  — same fade on the typeahead row when the master toggle is off.

Two specific freezes use this:

- **Star chart mode** disables `#show-milkyway` (the Milky Way layer is
  hidden under chart anyway, see
  `src/client/chart-mode/README.md`); `f.showMilkyway` is preserved so
  the toggle restores its prior state on chart-off.
- **`showConstellation === false`** disables `#con-input` and the
  surrounding `#con-picker` styling.

## Reverse-sync (DOM ← FilterState)

Panel widgets subscribe to `stellata.on('filter', …)` and write DOM
from the filter state. This is how URL restores and `naked eye`/`all`
presets update sliders and chip states. **Setting `.value`
programmatically does NOT dispatch `input`**, so there's no feedback
loop. If you add a filter field, remember to handle it in the panel's
`syncFromFilter`.

The FOV slider's reverse-sync is the one carve-out: it reads
`stellata.getCameraFov()` directly because FOV lives on the camera,
not in `FilterState`. `setCameraFov` fires the filter-change handlers
so the slider re-syncs after a debug-panel or URL-restore change.

The **active-preset highlight** on the magnitude-preset buttons is
value-driven, not click-driven: the reverse-sync compares
`f.maxAppMag` against each preset's value (epsilon 0.05) and toggles
the `.on` class on the matching button — so dragging the slider to
6.5 lights up "naked eye" the same as clicking it. Styling lives in
`styles.css :.mag-preset.on`.

For the underlying magnitude / FOV / star-size-exaggeration model
(presets, override flags, K table, soft-knee saturation), see
`../star-pipeline/README.md` § Magnitude presets and angular-size
calibration.

## Theme

Locked to dark in the live UI. The `setMonochrome` plumbing on
`Stellata` and the `body.monochrome` palette in CSS are intentionally
retained — `applyTheme('mono')` from the console flips the chart-mode
palette for future repurposing. There's no longer a UI toggle and the
theme is not part of the URL `?v=` state.

## Layout containers: `.ui-top-left`, `.ui-top`, `.ui-bottom`

The whole overlay UI is three pure-CSS fixed containers — **no breakpoints,
no JS measurements**. An earlier attempt used `ResizeObserver` to drive
`panel.style.top` / `maxHeight`; the user explicitly rejected that ("use
native html/css... we shouldn't dictate layout"). Do not reintroduce it.

- `.ui-top-left` — fixed top-left, holds the brand box. Independent of
  `.ui-top` so the right-side stack's width / wrap behaviour stays
  untouched.
- `.ui-top` — fixed top-right, `flex-direction: column`, bottom-bounded
  at the same 16px page margin as `.ui-bottom`. Children in DOM order:
  topbar ("Navigate" heading + Focus/To search), panel (Settings), then
  the `.ui-top-bottom` group — focus card + meta (star count / time
  scrubber) — pinned to the column floor by a single
  `margin-top: auto`. Because panel is a flex child below the topbar,
  it can never overlap it, and an expanding scrubber pushes the focus
  card up through normal flex layout — no fixed clearances, no
  measurement.
- `.ui-bottom` — fixed full-width along the bottom, holding the
  scale-bar widget (left; see § Bottom-left widget below).
- `.meta` is the catalog count (`.meta-count`, e.g. "313,242 stars") +
  the time readout / scrubber. Focused-object identity + camera
  distance live in the focus card (`../focus-card/README.md`).
- Both containers set `pointer-events: none` on themselves and `auto` on
  direct children, so clicks fall through empty regions to the canvas.

## Bottom-left widget: scene-scale bar

`scale-bar.ts` is a single SVG. Targets ~20% of viewport width;
`niceRound` snaps the represented distance to a 1/2/5×10^N value, then
the bar's pixel width tracks `nicePc × pxPerPc` exactly so it lands on
a clean number. Three internal ticks at 25/50/75% break the length up
so the user can read sub-divisions without thinking. Label is centred
on the **right endcap**, not the bar midpoint — internal ticks made a
midpoint-anchored label read as "this distance applies to the nearest
tick". In OBSERVE mode the bar switches to angular-extent-of-sky in
degrees (FOV-driven) since "scene scale at camera-target depth" is
meaningless when the camera sits on the focal star. Scene-scale during
a warp already targets B from warp start (`controls.target` is
repointed at B at warp launch — see `src/client/camera/warp/README.md`
§ Scale-bar smoothness).

The former **focus z-axis indicator** (an angled line from the bar's
left end aiming at the focused object, carrying its name +
camera-to-focus distance) is retired — the focus card
(`../focus-card/README.md`) is the home for focused-object identity
and live camera distance.

**Unit auto-switch.** The bar label uses `fmtDistAuto` from
`distance-util.ts`: pc/ly above 0.01 pc (respecting the user's pc/ly
toggle), AU below. The threshold is a one-way switch where "0.005 pc"
reads as awkward but "1031 AU" lands in the user's mental Voyager /
outer-Oort frame of reference. Sub-AU readings stay in AU with
3-decimal precision (orbit floor for Sol-class is ~0.005 AU, so we
never need scientific notation in normal use). See `distance-util.ts
AU_SWITCH_PC` for the constant.

## Fullscreen toggle

`fullscreen.ts` calls `requestFullscreen()` on `document.documentElement`
(the `<html>` element), not the canvas — every chrome container is a
sibling of the canvas under `<body>`, so fullscreening the whole page
keeps the panel/topbar/overlays visible. Bound to a double-tap `F`-`F`
in every mode (single `F` opens the Find picker in observe mode only);
there is no in-app affordance. Esc handling is left entirely to the browser: the
Fullscreen API reserves Esc for the exit and the exit is not cancelable
by page code, so any attempt to layer app behaviour under a
fullscreen-active Esc is unreliable (some browsers don't even dispatch
the keydown for the exiting keystroke).

## Hide-controls toggle

`controls-hidden.ts` toggles `body[data-controls-hidden]`, which hides
the right-hand column's interactive controls (`#topbar`, `#panel`,
`#focus-card`). Everything else — brand box, meta readout / time
scrubber (also in the column, kept visible), scale bar, tooltip, warp
button, and the `#overlay` SVG (constellations, star names, focus
ring) — stays visible. `#controls-restore-btn` is a fixed top-right box, `display:
none` by default and shown via `body[data-controls-hidden]
.controls-restore-btn`. It sits where the controls were, showing a `+`
that expands (ease-in-out) to "Show controls" on hover/focus; clicking
it, or pressing `U` again, restores the controls.

## `[hidden]` specificity and `.modal { display: grid }`

The HTML `hidden` attribute maps to `[hidden] { display: none }` in the UA
stylesheet — specificity (0,1,0). `.modal { display: grid }` has the same
specificity (0,1,0), and site stylesheets win ties, so `modal.hidden = true`
had **no visible effect** on the modal. Fixed globally with
`[hidden] { display: none !important; }` in `styles.css`. If you add
another class that sets `display` on an element that may be `hidden`ed
imperatively, you're already covered — but don't remove the `!important`
rule.

## `backdrop-filter` creates stacking contexts

Both `.topbar` and `.panel` use `backdrop-filter: blur(6px)`, which
silently creates a stacking context. Children's `z-index` is then clamped
to that context — so `.search-results` with `z-index: 12` inside `.topbar`
was painted **below** `.panel` (which has no z-index but appears later in
DOM order). Fixed by giving `.topbar` an explicit `z-index: 1` to lift its
whole context above `.panel`. If you add more blurred panels, remember
that every one of them is a new stacking boundary.
