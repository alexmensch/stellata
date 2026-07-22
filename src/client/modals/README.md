# Modal overlays

About / Credits, Share, Help, the welcome splash, and the mobile
advisory. Modals are imperatively shown / hidden; ESC / backdrop /
close-button binding is shared via `modal-dismiss.ts`.

## Brand box, About/Credits modal, and Share

`.ui-top-left` is a fixed top-left container holding the "Stellata"
title plus a small `about · share ⧉` link row (always visible — no
hover affordance, since touch devices have no hover state). The
`.brand-box` flex column is `align-items: center` so the narrow title
and the wider link row sit symmetrically around the centre axis.
Fullscreen (double-tap `F`-`F`) and hide-controls (`U`) are keyboard-only — see
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
and the share-button click handler in one `bindBrandModals(starCount)`
call, and populates the About pane's version + live star count (the
count shares `catalog.count` and the `toLocaleString` path with the
welcome info modal — no second formatter).
The `.ui-top-left` container sits independently of `.ui-top` so
changes to the right-side stack's width / wrap behaviour don't
affect the brand.

## Help modal

The `?` keyboard-shortcut surface. Same dismissal contract as About /
Credits — `modal-dismiss.ts` binds ESC + backdrop + close-button on
every `.modal` card; new modals get the same behaviour for free.
ESC dismisses only the top-most open modal (last-opened wins), and
dismiss triggers are click-delegated on the modal root, so
`[data-modal-dismiss]` buttons injected after bind time work too.

## Mobile advisory

`mobile-advisory.ts` shows a soft, dismiss-per-session warning that
Stellata isn't optimised for small screens / touch and that a keyboard
is effectively required. It is a soft warning, not a hard gate.

`maybeShowMobileAdvisory()` is called from `main.ts` and returns
whether it showed — when it does, the caller suppresses the welcome
modal so only one splash competes for the screen. The show heuristic
lives in `mobile-advisory-pure.ts` (`shouldAdviseMobile`): a narrow
viewport (`< MOBILE_ADVISORY_MAX_WIDTH`) that also looks touch-only
(`matchMedia('(pointer: coarse)')` and `navigator.maxTouchPoints > 0`),
so an iPad-with-keyboard passes through; it falls back to
viewport-width-only when the pointer/touch signals are unavailable.
Dismissal writes `stellata.mobile-advisory-dismissed` to
`sessionStorage`, so the splash appears at most once per session, not
once ever — the underlying viewport constraint doesn't go away after
one dismissal, so a returning small-viewport user gets re-advised each
new session instead of silently falling through to the welcome modal
forever after the first close.

The broader minimum-viewport / WebGL2-capability gating decision
(`stellata-qsg`) is out of scope here — this is only the advisory.
