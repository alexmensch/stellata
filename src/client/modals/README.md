# Modal overlays

About / Credits, Share, Help. Modals are imperatively shown / hidden;
ESC / backdrop / close-button binding is shared.

## Brand box, About/Credits modal, and Share

`.ui-top-left` is a fixed top-left container holding the "Stellata"
title plus a small `about · share ⧉` link row (always visible — no
hover affordance, since touch devices have no hover state). The
`.brand-box` flex column is `align-items: center` so the narrow title
and the wider link row sit symmetrically around the centre axis.
Fullscreen (`F`) and hide-controls (`U`) are keyboard-only — see
`src/client/ui/README.md` § Fullscreen toggle and § Hide-controls
toggle.

`about` opens a single tabbed `<div class="modal">` card that
combines what used to be two separate modals. The title row is a
`.modal-tabs` tab bar: `ABOUT STELLATA · credits`, with the active
tab at title weight (`var(--fg)`) and the inactive at `var(--fg-dim)`
acting as a `.link-btn`-style click target. Clicking the inactive
tab swaps which `.modal-pane` is visible and flips both `is-active`
states. Opening from the brand box always resets to the About tab —
no last-viewed memory. ESC, the close button, or the backdrop
dismisses; there's no "don't show again" opt-out because the modal
is user-initiated.

`share ⧉` copies `window.location.href` (the full view encoded into
the URL via `?v=`) to the clipboard and briefly
flips its trailing glyph to `✓` on success or `⨯` on failure
(insecure context / no `navigator.clipboard`). The `.share-link`
class width-locks the slot so the glyph swap never reflows the flex
row.

`brand-modal.ts` wires the modal-dismissal helper, the tab swap,
and the share-button click handler in one `bindBrandModals()` call.
The `.ui-top-left` container sits independently of `.ui-top` so
changes to the right-side stack's width / wrap behaviour don't
affect the brand.

## Help modal

The `?` keyboard-shortcut surface. Same dismissal contract as About /
Credits — `modal-dismiss.ts` binds ESC + backdrop + close-button on
every `.modal` card; new modals get the same behaviour for free.
