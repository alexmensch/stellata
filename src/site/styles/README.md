# Site stylesheet

`site.css` is every public page's stylesheet: it imports
`src/design-tokens.css` and adds only the site's own scales, compositions
and blocks. The pages it styles are `../README.md`'s.

## House style

**Load the `cube-css` skill before editing it.** What this section records is
the house style — which layer a rule landed in here, and why. The system
underneath it (the layout primitives, the no-width-query mandate, the review
gates) is the skill's, and a README describing the one reads convincingly
like coverage of the other.

`site.css` is organised **CUBE-style**, in this order, and the order is the
cascade: tokens, global element defaults, **C**ompositions, **B**locks,
**U**tilities, with exceptions carried as `data-` attributes on a block
rather than as modifier classes. A rule that belongs one layer up is the
drift to watch for — a block reinventing a gap that `.flow` already owns is
the common one, and a second `flex-wrap` rule is a duplicate `.cluster`
rather than a new composition.

**Utilities come last and carry `!important`**, because a utility is a final
adjustment nothing before it may override. The corollary decides what is a
utility at all: anything a block must be able to override is **not** one. A
rule with a state, a descendant selector, or a value a block legitimately
changes is a block — which is why `.label`, `.lead`, `.aside` and
`.skip-link` sit in the block layer despite looking like text utilities, and
only `.wrapper`, `.measure` and `.dim` are utilities.

**The call to action is an exception, not a block.** `.pill[data-primary]`
fills the pill with the accent and inverts its text to the page ground; plain
`.pill` stays outlined. Opt-in deliberately — a page where every pill is
filled has no primary action — and an exception rather than a second block
because the shape, padding and typography are all the pill's, and only the
fill differs.

**Hover swaps the pair.** The outlined pill fills; the filled one empties
into exactly the outlined pill's hover treatment. So the two are inverses and
hover reads as a state change rather than a shade of one.

That rule restates all three properties, and has to. `.pill[data-primary]`
and `.pill:hover` carry equal specificity, so with no rule of its own the
filled state simply keeps winning and the button never reacts; with a rule
that sets only `color` and `border-color`, the accent fill stays and the text
turns accent on accent. `tests/site-css-rules.test.ts` fails the build on
either. Focus needs nothing special: the global `:focus-visible` ring carries
an `outline-offset`, so it lands on the page ground outside the fill.

**The palette is not ours to set.** `site.css` imports
`src/design-tokens.css` and must not restate a colour or the typeface. The
app's chrome is the reference: near-black ground, monospace throughout, 1px
hairline borders, square corners, small uppercase wide-tracked labels, one
cyan accent. The site scales that up to reading sizes — it does not add a
second visual language. A colour belonging to both surfaces goes in the
token file; one belonging only here (`--bg-sunken`) goes in this file's own
`:root` block, as the scales and measures do.

**Alpha variants are mixed, not restated.** Every halo and wash is a
`color-mix(in srgb, var(--token) N%, transparent)`, so the hex for the
ground and the accent exists in exactly one place. Writing
`rgba(7, 9, 18, 0.72)` would fork the palette silently the next time a token
changed.

**No rule carries a bare value.** Measures are a named scale
(`--measure-micro` … `--measure`) and spacing comes from the Utopia steps;
so do leading (`--leading-flat` … `--leading-body`), tracking
(`--tracking-caps`, `--tracking-display`), weight and the pill radius. The
one-off lengths a composition needs — the column minimum before a switcher
stacks, the readout's minimum cell, the sources table's name column — are
named in `:root` too. Logical properties throughout:
`max-inline-size`, `border-block-end`, `inset-inline-start`,
`text-align: start`.

One tracking value serves every uppercase label (`--tracking-caps`), where
three near-identical figures used to sit; the visual language is one
decision, not one per block.

`tests/site-css-rules.test.ts` asserts all of it — the cascade order, the
`!important`, the absence of colour literals and physical properties, and
that every space is a scale step.

## The scales

Type and space are **fluid Utopia scales** (utopia.fyi), interpolating
between a 320px and a 1440px viewport. Every `--step-*` and `--space-*`
value is a generated `clamp()`; **do not hand-edit one**, and do not
introduce a size outside the scale — the whole point is that a heading and
the space above it move together, which a one-off `clamp()` breaks.

Parameters, to regenerate: viewport 320 → 1440px · type base 16 → 20px,
ratio 1.2 → 1.25, steps −2 … 6 · space base 16 → 20px at multipliers
0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3 / 4 / 6, plus the one-up pairs the
page uses. Paste those into utopia.fyi's calculators, or compute
`clamp(min, (min − slope·320)/16 rem + slope·100 vw, max)` with
`slope = (max − min)/1120`.

## Responsiveness has no breakpoints

There is not one `@media (min-width: …)` rule in the file, deliberately:
this app is looked at on every shape of screen, and a page whose layout
switches on the *viewport* is wrong for every element that isn't the width
of the viewport. Three mechanisms replace them.

- **`.flow`** owns all vertical rhythm through one owl selector. An element
  changes the gap *above itself* by setting `--flow-space`, and a container
  changes its children's gaps with `X > * { --flow-space: … }`; nothing sets
  a bespoke margin. **`--flow-space` is registered `inherits: false`**, so a
  value set on a container itself does nothing — without that, it reached
  every nested `.flow`'s children too.

  **A missing gap has two causes, and the second is the likely one.** Either
  the container lacks `.flow` — visible, and the fix is obvious — or a block
  **cancelled** the gap `.flow` gave it, by declaring a vertical `margin` in
  the block layer, which cascades after compositions and therefore wins. That
  second one is silent: the composition is present and correct, and the
  element still sits flush. It happened twice here, `.spec-list` and `.plate`
  each restating the global `margin: 0` reset one layer too late.

  So: a block needing a reset means adding its element to the **global**
  reset, where `.flow` still wins; a block needing a different gap sets
  `--flow-space`. Neither ever writes a vertical margin, and
  `tests/site-css-rules.test.ts` fails the build on one that does.
- **`.switcher`** is Every Layout's two-up: side by side above
  `--switcher-threshold`, stacked below it, decided by the **container's**
  width. `flex-basis: calc((threshold − 100%) * 999)` is the whole
  mechanism — the multiplier drives the basis past 100% the instant the
  container is narrower than the threshold. It is not a magic number to
  tidy; a smaller one stops the flip working. The threshold itself is
  **derived**, not chosen: `items × --switcher-item + gaps`, so a block
  says how wide one column wants to be (`--switcher-item-sight`) and the
  switch point follows. Changing the column minimum moves it correctly.
- **Intrinsic grids** (`repeat(auto-fit, minmax(min(x, 100%), 1fr))`) for
  the readout strip, which reflows cell by cell. **The `min()` is not
  optional.** A bare `minmax(11rem, 1fr)` forces a track wider than a
  narrow container, and because a `rem` minimum grows with the reader's
  font size while the viewport does not, it fits a 320px screen at a 16px
  root and overflows it at the 32px root that WCAG 1.4.4's 200% text
  resize implies. `min(x, 100%)` collapses the track instead.

  Each cell then **subgrids the band's two rows** (`grid-row: span 2` +
  `grid-template-rows: subgrid`), so a label wrapping to two lines raises
  every value in that band instead of dropping its own — the figures read as
  a row however the labels wrap, at any width. Labels take `align-self:
  start` and figures `align-self: center`, so a label hugs the top of its
  row and a figure sits centred in a row another cell's wrapped figure made
  taller. The consequence to know: a subgridded axis takes its gutter from
  the **parent**, which here is the 1px hairline, so the label carries the
  separation below itself as `padding-block-end` and not a `gap` on the
  cell. Restoring that `gap` looks tidier and silently closes the space.

  **`dd` is in the global reset for this strip's sake.** The UA stylesheet
  indents a `dd` by 40px, which on an 11rem cell puts a short figure near
  the middle and reads as centred text rather than as an indent — the bug
  that hid here until the figures were meant to line up. Adding the element
  to the global reset is the fix, per § Responsiveness's rule that a block
  needing a reset never writes the margin itself.

`.sight`'s alternating sides ride the switcher: `flex-direction:
row-reverse` on even rows puts the media right when there is room, and a
reversed row that wraps still stacks in DOM order — so the media never
lands *under* its own caption on a phone. That property is why the
alternation needs no query. It counts sights only (`:nth-child(even of
.sight)`), so a claim or plate placed between two sights leaves the sides
alternating.
