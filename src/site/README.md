# Public content site

The pages served from `stellata.xyz` that are **not** the 3D application:
authored HTML, no JavaScript, no framework. The homepage is the only one so
far, and it is the site root — the application lives at `/app`
(`src/client/app/README.md`).

```
index.html   The homepage, served at /. Documented below. Its markdown
             rendition is derived from it at build time (§ below), not
             authored — there is no `index.md` here to edit.
404.html     Served for every unmatched path — by Cloudflare's
             not_found_handling = "404-page" (wrangler.toml) in production,
             and by the dev server's document routing locally. Carries
             noindex and is not in the sitemap.
site.css     Every page's stylesheet. Imports src/design-tokens.css and
             adds only the site's own scales, compositions and blocks.
```

## The build seam

`vite.site.config.ts` (repo root) is a **second** Vite build with `root` at
this folder. `package.json` runs the two in order:

```
build:client  vite build                             → dist/  (empties it)
build:site    vite build --config vite.site.config.ts → dist/  (adds to it)
```

**Order is load-bearing.** The app pass carries `emptyOutDir: true` and
copies `public/`; the site pass carries `emptyOutDir: false` and
`publicDir: false`. Run the site pass first, or alone into a stale `dist/`,
and the app pass wipes it. `pnpm run build` and `pnpm run deploy` chain them
correctly — `build:site` alone is for iterating, not for producing a
deployable tree.

Hashed asset names keep the two passes' `dist/assets/` output from
colliding.

## A page's path is its folder, and that is what serves the URL

Vite emits each HTML input at **its own path relative to `root`**. So
`src/site/index.html` lands at `dist/index.html` and is served at `/`,
while the application's `src/client/app/index.html` lands at
`dist/app/index.html` and is served at `/app`. The built tree mirrors the
URL space exactly; no build step and no rewrite reconciles them.

A new page is therefore: a folder here holding `index.html` (plus its
README), and one line in `vite.site.config.ts`'s `input` map. The map key is
cosmetic — the input path decides the URL.

**Routing that the tree cannot express lives in the Worker**, not here:
the legacy share-link redirects and the app's unmatched-path fallback.
`src/README.md` § Request routing is the authority, and the reason
`wrangler.toml` no longer carries
`not_found_handling = "single-page-application"`.

## Reading it in dev

**`pnpm run dev` serves the whole URL space on one port**, matching the
deploy: the homepage at `http://localhost:5173/`, the app at
`http://localhost:5173/app`, this folder's 404 page for anything else, and
a 301 off either legacy share transport. That is `vite.site-dev.ts`, a
dev-only plugin on the *app's* config — the two build passes have different
roots, so nothing else would have put both documents on one server.

It needs `appType: 'custom'` there, and that is not a detail to undo:
Vite's own SPA fallback rewrites an unmatched path to `/index.html` before
any plugin middleware runs, which made every wrong URL — and `/app` itself
— serve the homepage.

`pnpm run dev:site` still serves this folder alone on port 5174, rooted
here, for iterating on a page without the app's build chain in front of it.
Three things differ from production there, which is why it is the secondary
route: a page in a subfolder needs its trailing slash (`/science/`, not
`/science`), a miss gets nothing rather than the 404 page, and a share link
is not redirected.

## The markdown rendition — how an agent reads these pages

Every page here is also served **as markdown**, at its own `.md` path and
at its canonical URL to any client whose `Accept` header names
`text/markdown`. The homepage's is `dist/index.md`, served at `/index.md`.

Why it is worth having, stated precisely: an agent can already read this
page either way — the HTML is semantic and script-free, so a fetcher
converts it to markdown itself. What it loses doing that is **the
wording**. The converter's own summariser paraphrases, where a rendition
is read close to verbatim, at roughly a third of the bytes. It is not the
lever for being *recommended* by an answer engine — crawlability, the
JSON-LD graph, `public/llms.txt` and inbound links are that — it is the
lever for being **quoted correctly** once one has the URL.

**The rendition is derived from the page, never authored beside it.**
`scripts/site/markdown-rendition.ts` is the authority on how, and on what
it drops; `src/negotiation-pure.ts` owns the `Accept` rule, shared by the
Worker and the dev server so they cannot answer differently.

Three things follow for anyone editing a page here:

- **A new element can fail the build.** The derivation carries a closed
  element vocabulary and throws on a tag it has no rule for, rather than
  dropping the section. Reaching for `<details>` means deciding what it
  means in markdown first.
- **A new page needs two lines**, not one: an `input` entry in
  `vite.site.config.ts` *and* a rendition in the same config's map, plus a
  path in `markdownRendition()`. A page without a rendition simply serves
  HTML to everyone, which is a working state rather than a broken one.
- **`Accept` now changes what `/` answers**, so both renditions carry
  `Vary: Accept`. A cache that did not know would serve one to the other.

**Markdown is opt-in by naming the type.** A wildcard `Accept` — curl's
default, and most agent fetchers' — still gets HTML, because that is what
the deploy has always answered and what a browser needs. Only a client
that names `text/markdown`, and does not rank `text/html` above it, gets
the rendition.

## No JavaScript, by rule

These pages ship zero script. It is what keeps them instant, indexable
without rendering, and readable on the browsers the application itself
turns away — someone whose browser has no WebGPU still gets the whole case
for the project. A page that needs interaction is a signal to ask whether
it wants to be part of the app instead.

## The stylesheet

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

**The palette is not ours to set.** `site.css` imports
`src/design-tokens.css` and must not restate a colour or the typeface. The
app's chrome is the reference: near-black ground, monospace throughout, 1px
hairline borders, square corners, small uppercase wide-tracked labels, one
cyan accent. The site scales that up to reading sizes — it does not add a
second visual language. A colour belonging to both surfaces goes in the
token file; one belonging only here (`--bg-sunken`) goes in this file's own
`:root` block, as the scales and measures do.

**Alpha variants are mixed, not restated.** Every scrim and wash is a
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

### The scales

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

### Responsiveness has no breakpoints

There is not one `@media (min-width: …)` rule in the file, deliberately:
this app is looked at on every shape of screen, and a page whose layout
switches on the *viewport* is wrong for every element that isn't the width
of the viewport. Three mechanisms replace them.

- **`.flow`** owns all vertical rhythm through one owl selector. An element
  changes the gap *above itself* by setting `--flow-space`; nothing sets a
  bespoke margin.

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

`.sight`'s alternating sides ride the switcher: `flex-direction:
row-reverse` on even rows puts the media right when there is room, and a
reversed row that wraps still stacks in DOM order — so the media never
lands *under* its own caption on a phone. That property is why the
alternation needs no query.

## The homepage's shape

In order down the page, and the order is the argument:

1. **Hero** — the imagery, full-bleed, with the `h1` over it and the
   masthead riding on top of the same image. Stellata is a visual
   instrument; the page leads with what it looks like, not with prose.
2. **Readout strip** — five figures, three of them substitutions.
3. **What it is** — three claims, one each: a serious instrument for people
   who already know the sky · every object from a published catalogue, and
   the page says which · what the eye would see from any point in the
   model, no false colour anywhere. Rewriting the copy is expected;
   dropping one of the three is not.
4. **Where to go first** — the sights, § below. The section the page is
   for.
5. **The record** — the citation table and the four provenance claims.
   Late on purpose: it is the proof, and proof follows the case.
6. **Before you click** — WebGPU and desktop, two columns, short.

**No section is numbered.** A landing page that numbers its sections reads
as a specification; the eyebrow label above each `h2` carries the same
structure without it.

## Numbers in copy

**No figure on these pages is a literal.** `scripts/site/site-metrics.ts`
counts each off the thing it describes and `vite.env.ts` publishes it, so
the page carries `%VITE_STAR_COUNT%`, `%VITE_SOURCE_COUNT%`,
`%VITE_REFERENCE_COUNT%` and `%VITE_APP_VERSION%` and the build fills them
in. That module's README is the authority on where each count comes from
and why the reference count is a floor.

`tests/site-claims.test.ts` holds the pages to it: each readout cell must
still carry its substitution rather than a number, the subsystem table must
still sum to the credited total, and the derivations must not have
collapsed. Two cells are prose because nothing in the repo can count them —
**6.5 million light years** and **3000 BC – 3000 AD**, the model's measured
radius and its clock clamp, both stated in `../../README.md`.

Rounded prose is a different case and is still fine — the hero's "around
390,000 real objects" is held true by
`tests/star-count-consistency.test.ts`, which reads this folder's pages
among its prose surfaces. `docs/authoring-patterns.md` § The star count is
never a literal.

**The JSON-LD graph shares nodes with the application.** `Person` and
`WebApplication` carry the same `@id`s and the same `description` string
here as in `src/client/app/index.html`, so a crawler resolves one
application described twice rather than two applications. Edit either node
and edit both. The `WebApplication.url` is `/app`; its `@id` keeps the
bare-root form, because an `@id` is an identifier rather than an address.

## Sights — the media, and the link it carries

Each sight in § Where to go first is one `.sight`: a picture (or a short
silent loop) beside its copy, **where the picture is itself the link into
the model at that view.** Both halves come out of one act at the machine —
take the capture, then copy the address bar — which is what makes the
image and the URL incapable of disagreeing. Deriving a share URL separately
from the shot is the failure this shape exists to prevent.

Every media slot currently holds a **`.holder`**: a dashed hairline box
naming what to capture and the filename to save it as. The dashed border is
deliberate — an empty styled box would ship unnoticed. `stellata-2h0e.8`
tracks filling them.

To land a real capture:

1. Take the shot from the running app at 2400 px wide or more.
2. Save it under `public/site/` as the filename the holder names.
   `public/` is the app pass's `publicDir`, so the file is served at
   `/site/<name>` with no build step. Commit it — the SEO assets in
   `public/` (`og-image.jpg`, the icons) are committed the same way.
3. Replace the `<div class="holder">…</div>` with
   `<img src="/site/<name>" alt="…" width="…" height="…" />`. Real
   `width`/`height` attributes matter — they reserve the space and keep
   the page's layout shift at zero. `.sight-media` already carries the
   hairline border, and `.sight-media > img` the full-width rule.
4. Put the address bar's URL on **both** anchors in that row — the media
   and the "Fly there" line.

**The links in the file today are starting points, not captures.** Each is
a focus-only share blob — one field, the object's SID — so it lands on that
object at its park pose, which is where the shot should be taken from. Two
rows differ: the solar system links to bare `/app` (Sol is the canonical
default focus, so a default state has no blob at all), and chart mode
carries a real saved view. The galactic-disc row has no link at all,
because that view is a camera pose rather than a focused object and there
is nothing honest to derive.

Deriving smaller responsive variants and a `srcset` is worth doing once the
real images are in — a 2400 px JPEG is the largest thing on the page by an
order of magnitude, and it is the one lever on the page's largest
contentful paint.

## Pages anticipated but not built

The masthead nav is the slot for them. Today its "Science" and "Cite" links
point at GitHub; each becomes a local page when one exists.

- `/science` — the cited data-source record as a web surface rather than
  `SCIENCE.md` on GitHub. Tracked as `stellata-2h0e.3`.
- `/release-notes` — the per-version notes the deploy workflow currently
  publishes only to GitHub releases. Tracked as `stellata-2h0e.4`.
- A blog or writing index, unscoped.

`/sid/NNNNN` per-object pages (`stellata-2bt4`) want this same seam, with
one difference worth knowing before designing it: those pages are generated
per object, so they need a build step that writes inputs rather than a
hand-maintained `input` map.
