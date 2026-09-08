# Public content site

The pages served from `stellata.xyz` that are **not** the 3D application:
authored HTML, no JavaScript, no framework. The homepage is the only one so
far, and it is the site root — the application lives at `/app`
(`src/client/app/README.md`).

```
index.html   The homepage, served at /. Documented below.
404.html     Served for every unmatched path — by Cloudflare's
             not_found_handling = "404-page" (wrangler.toml) in production,
             and by the dev server's document routing locally. Carries
             noindex and is not in the sitemap.
site.css     Every page's stylesheet. Imports src/design-tokens.css and
             adds only the site's own layout, type scale and components.
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
`http://localhost:5173/app`, and this folder's 404 page for anything else.
That is `vite.site-dev.ts`, a dev-only plugin on the *app's* config — the
two build passes have different roots, so nothing else would have put both
documents on one server.

It needs `appType: 'custom'` there, and that is not a detail to undo:
Vite's own SPA fallback rewrites an unmatched path to `/index.html` before
any plugin middleware runs, which made every wrong URL — and `/app` itself
— serve the homepage.

`pnpm run dev:site` still serves this folder alone on port 5174, rooted
here, for iterating on a page without the app's build chain in front of it.
Two things differ from production there, which is why it is the secondary
route: a page in a subfolder needs its trailing slash (`/science/`, not
`/science`), and a miss gets nothing rather than the 404 page.

## No JavaScript, by rule

These pages ship zero script. It is what keeps them instant, indexable
without rendering, and readable on the browsers the application itself
turns away — someone whose browser has no WebGPU still gets the whole case
for the project. A page that needs interaction is a signal to ask whether
it wants to be part of the app instead.

## The palette is not ours to set

`site.css` imports `src/design-tokens.css` and must not restate a colour or
the typeface. The app's chrome is the reference: near-black ground,
monospace throughout, 1px hairline borders, square corners, small uppercase
wide-tracked labels, one cyan accent. The site scales that up to reading
sizes — it does not add a second visual language. A colour belonging to
both surfaces goes in the token file; one belonging only here goes in
`site.css`'s own `:root` block, as the type scale and measures do.

## Numbers in copy

Prose here is subject to the same rule as everywhere else: **the star count
is never a literal a human types from memory.** Rounded prose is fine and
is held true by `tests/star-count-consistency.test.ts`, which reads this
folder's pages among its prose surfaces. `%VITE_APP_VERSION%` and
`%VITE_STAR_COUNT%` are available as Vite HTML substitutions
(`vite.env.ts` publishes both) — but `VITE_STAR_COUNT` is empty on a
checkout with no built catalogue, so any wording using it has to survive
the number being absent. `docs/authoring-patterns.md` § The star count is
never a literal.

## The homepage's claims

Three things the page has to make a reader take away, in this order,
because the order is the argument:

1. A serious instrument, built for people who already know the sky.
2. Every object came from a published catalogue, and the page says which.
3. It shows what the eye would see from any point in the model — no false
   colour anywhere, perceptual modelling throughout.

§ 01's three numbered claims are those three, one each. Rewriting the copy
is expected; dropping one of the three is not.

**Every number is derived, not typed**, and `tests/site-claims.test.ts`
fails when the page and its sources disagree:

- **34 catalogues cited**, and the per-subsystem counts in the § 02 table,
  are the credit rows in the application's own Credits tab
  (`src/client/app/index.html`, `.modal-credits`). The test counts them.
  Adding a source to the app means updating this page in the same PR.
- **100+ published references** is a floor on the distinct author-year
  citations across the modelling record — the two root docs plus every
  markdown file under `docs/`, `src/`, `scripts/` and `data/`. The test
  counts only the multi-author forms (`Høg et al. 2000`,
  `Bland-Hawthorn & Gerhard 2016`), so single-author citations are real
  references it cannot see and the true total is higher. It holds the
  page's claim below the derived figure and within one bucket of it, so the
  claim stays true as the record grows and fails once it is stale enough to
  be misleadingly modest.
- **390,000 objects** is rounded prose — § Numbers in copy above.
- **6.5 million light years** and **3000 BC – 3000 AD** are the model's
  measured radius and clock clamp, both stated in `../../README.md`.
- Distances, periods and physical claims in § 03 are the ones
  `../../README.md` § Things to try already carries; that section is this
  section's source.

**The JSON-LD graph shares nodes with the application.** `Person` and
`WebApplication` carry the same `@id`s and the same `description` string
here as in `src/client/app/index.html`, so a crawler resolves one
application described twice rather than two applications. Edit either node
and edit both. The `WebApplication.url` is `/app`; its `@id` keeps the
bare-root form, because an `@id` is an identifier rather than an address.

## Plates

Three figures, each a numbered plate captioned like an atlas rather than a
screenshot with a caption. **All three currently hold placeholders** — a
dashed hairline box carrying the intended subject, why that view is the one
that proves the claim beside it, and the target filename. The dashed border
is deliberate: an empty styled box would ship unnoticed.

To land a real capture:

1. Take the shot from the running app at 2400 px wide or more.
2. Save it as the filename the placeholder names, under `public/site/`.
   `public/` is the app pass's `publicDir`, so the file is served at
   `/site/<name>` with no build step. Commit it — the SEO assets in
   `public/` (`og-image.jpg`, the icons) are committed the same way.
3. Replace the `<div class="plate-holder">…</div>` with
   `<img src="/site/<name>" alt="…" width="…" height="…" />`, leaving the
   `<figcaption>` alone. `.plate img` already carries the hairline border.
   Real `width`/`height` attributes matter — they reserve the space and
   keep the page's layout shift at zero.

The two views with an existing share URL carry it in the placeholder, so
the capture is reproducible rather than a one-off: plate 01 is the README
hero's composition, plate 03 the README chart-mode shot. Plate 02 (dust
extinction from a few kiloparsecs out) has no saved view; the recipe is in
`../../README.md` § Watch the dust shape the sky.

The placeholders quote each view in the canonical `/app/v/<blob>/` form
rather than the `/?v=<blob>` one the README screenshots used to carry. The
Worker still redirects the old form, but a quoted URL that depends on a
redirect is one nobody notices has gone stale.

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
