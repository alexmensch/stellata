# Public content site

The pages served from `stellata.xyz` that are **not** the 3D application:
authored HTML, no framework, and one small script (§ One script). The homepage is the only one so
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
styles/      site.css, every page's stylesheet, and its README.
replay.ts    The homepage's one script, § One script. Wires
             replay-control.ts (+ test) onto every video[data-replay].
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

**An edit to a page here reloads the browser**, and that takes the plugin's
own watcher wiring rather than Vite's: this folder is outside the app
server's root, so nothing here is watched by default, and Vite's own HTML
reload addresses a page by its path relative to that root — which no URL
served from here matches. The stylesheet needs none of it, being a real
module request.

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
page either way — the HTML is semantic and complete without script, so a fetcher
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

These pages ship no script beyond § One script. It is what keeps them
instant, indexable without rendering, and readable on the browsers the
application itself turns away — someone whose browser has no WebGPU still
gets the whole case for the project. A page that needs interaction is a
signal to ask whether it wants to be part of the app instead.

### One script

The exception is the sights' replay control, and it is shaped so the rule
still holds for everything else: **the page without it is the complete
page.** `replay.ts` builds each button itself, so a browser that runs no
script shows no dead control, and nothing on the page waits on it.

A clip opts in with a valueless **`data-replay`** on its `<video>`; the
hero does not carry it. The script wraps the media anchor in a
`.replay-frame` and puts the button beside the anchor, never inside it,
since a button inside a link is invalid and would follow the link.

The button shows whenever the clip is stopped — ended, paused, or refused
autoplay, which a browser in a power-saving mode does silently and which
only a rejected `play()` reports. A press replays the clip once from the
start, so the § Sights rule of no `loop` and under five seconds still holds.

A second script is a decision to take explicitly, not a precedent this one
sets.

## The stylesheet

`styles/site.css`, and the house style it is written in — the CUBE layers,
the Utopia scales, responsiveness without breakpoints: `styles/README.md`.

## The homepage's shape

In order down the page, and the order is the argument:

1. **Hero** — the imagery, full-bleed, with the `h1` over it and the
   masthead riding on top of the same image. Stellata is a visual
   instrument; the page leads with what it looks like, not with prose.
   **Nothing dims the hero to make text readable.** The copy and the
   masthead both carry `--text-halo` on the glyphs instead of a scrim
   behind them, because the imagery is already a dark-adapted frame and a
   scrim spends the contrast twice. The reason it is written down: the
   obvious repair for text that looks marginal over a bright frame is a
   scrim, and that is the one repair this hero may not have. Grade the
   media darker, or move the copy.

   The one overlay that stays is `.hero-media::after`, and it is a
   different thing doing a different job: a gradient to the page ground
   climbing `--hero-fade` from the bottom edge, so the frame dissolves into
   the band below rather than ending on a cut. Tuning its reach by eye is
   expected. **It stops being that overlay and starts being a scrim the
   moment it reaches far enough to sit behind the heading** — which is the
   line to hold, not the number.
2. **Readout strip** — five figures, three of them substitutions.
3. **Start exploring** — the sights, § below. The section the page is
   for. Three `.claim` articles sit among them, one claim each: a serious
   instrument for people who already know the sky · every object from a
   published catalogue, and the page says which · what the eye would see
   from any point in the model, no false colour anywhere. Rewriting or
   moving the copy is expected; dropping one of the three is not.
4. **The record** — the citation table and the four provenance claims.
   Late on purpose: it is the proof, and proof follows the case.
5. **Before you click** — WebGPU and desktop, two columns, short.

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
**6.5 Mly** and **3000 BCE – 3000 CE**, the model's measured radius and its
clock clamp, both stated in `../../README.md`.

Rounded prose is a different case and is still fine — the "Before you click"
aside's "around 980,000 records" is held true by
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

Each sight in § Start exploring is one `.sight`: a picture (or a short
silent loop) beside its copy, **where the picture is itself the link into
the model at that view.** Both halves come out of one act at the machine —
take the capture, then copy the address bar — which is what makes the
image and the URL incapable of disagreeing. Deriving a share URL separately
from the shot is the failure this shape exists to prevent.

A slot not yet filled holds a **`.holder`**: a dashed hairline box naming
what to capture and the filename to save it as. The dashed border is
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

   **A clip goes in the same slot**, and `.hero-media > video` /
   `.sight-media > video` already size it:

   ```html
   <video src="/site/<name>.mp4" poster="/site/<name>.jpg"
          aria-label="…" width="…" height="…"
          autoplay muted playsinline></video>
   ```

   Four of those are load-bearing. `muted` and `playsinline` are what any
   browser requires before it will start a clip unasked, and iOS needs the
   second even so. `poster` is the frame that carries the page's largest
   contentful paint and the one a browser refusing to autoplay shows
   instead — so it is a real still, saved beside the clip. `aria-label` is
   the clip's accessible name. The rendition **stops the build** on a clip
   missing the poster or the label (`scripts/site/README.md`).

   **No `loop`, and keep it under five seconds.** Nothing on these
   pages offers a pause control — and WCAG 2.2.2
   requires one for motion that starts on its own and runs longer than
   that. A clip that plays once and holds its last frame needs no control
   to comply. A looping hero would need one and has nowhere to put it.

   Encode 1920×1080 H.264 High, `yuv420p`, no audio track, `-movflags
   +faststart`, and the poster is the clip's **last** frame so the still
   and the frame it settles on agree. **CRF around 17, not the usual 21.**
   These scenes are near-black gradients — a dust lane, a Milky Way band —
   and that is the content H.264 blocks up first, visibly, while costing
   little to encode well: the hero's 4.2 s is 632 kB at 17. A starfield in
   motion costs several times a gradient at the same CRF, which is the
   content rather than a mistake.

   The **`site-media` skill** carries the procedure this spec implies: what
   to measure before cropping (delivered frame rate, and content bounds
   across every frame rather than one), when to pad instead of crop, and
   when a capture has to be re-shot rather than rescued.
4. Put the address bar's URL on **both** anchors in that row — the media
   and the `.sight-go` line.

A clip's row carries its `debug.capture()` call in an HTML comment beside
the `<video>`, so a re-shoot replays the same take. Its `end` blob — or
`start`, for a take that only moves the clock — is the row's link.

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
