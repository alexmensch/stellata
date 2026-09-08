# Public content site

The pages served from `stellata.xyz` that are **not** the 3D application:
authored HTML, no JavaScript, no framework. `/home` is the only one so far.
The app lives at `/` and is built separately (`src/client/`).

```
site.css        Every page's stylesheet. Imports src/design-tokens.css and
                adds only the site's own layout, type scale and components.
home/           The homepage served at /home. Its README owns the copy's
                claims and the plate placeholders.
```

## The build seam

`vite.site.config.ts` (repo root) is a **second** Vite build with
`root` at this folder. `package.json` runs the two in order:

```
build:client  vite build                             → dist/  (empties it)
build:site    vite build --config vite.site.config.ts → dist/  (adds to it)
```

**Order is load-bearing.** The app pass carries `emptyOutDir: true` and
`publicDir`; the site pass carries `emptyOutDir: false` and
`publicDir: false`. Run the site pass first, or alone into a stale `dist/`,
and the app pass wipes it. `pnpm run build` and `pnpm run deploy` already
chain them correctly — `build:site` on its own is for iterating, not for
producing a deployable tree.

Hashed asset names keep the two passes' `dist/assets/` output from
colliding.

## A page's path is its folder, and that is what serves the URL

Vite emits each HTML input at **its own path relative to `root`**, so
`src/site/home/index.html` lands at `dist/home/index.html`. Cloudflare's
static-assets layer defaults to `html_handling = "auto-trailing-slash"`,
which serves `dist/home/index.html` at `/home`. Nothing in `src/worker.ts`
routes it; the Worker hands every request to `env.ASSETS.fetch`.

So a new page is two steps: a folder here holding `index.html` (plus its
README), and one line in `vite.site.config.ts`'s `input` map. The map key
is cosmetic — the input path decides the URL.

**This does not conflict with the app's SPA fallback.** `wrangler.toml` sets
`not_found_handling = "single-page-application"` so `/v/<blob>/` share links
reach the app's `index.html`; asset and HTML matching both run first, so a
page that exists is served as itself and only genuinely unmatched paths fall
through to the app.

## No JavaScript, by rule

These pages ship zero script. It is what keeps them instant, indexable
without rendering, and readable on the browsers the app itself refuses —
someone whose browser has no WebGPU still gets the whole case for the
project. A page that needs interaction is a signal to ask whether it wants
to be part of the app instead.

## The palette is not ours to set

`site.css` imports `src/design-tokens.css` and must not restate a colour or
the typeface. The app's chrome is the reference: near-black ground,
monospace throughout, 1px hairline borders, square corners, small uppercase
wide-tracked labels, one cyan accent. The site scales that up to reading
sizes — it does not add a second visual language. A colour that belongs to
both surfaces goes in the token file; one that belongs only here goes in
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

Counts describing the citation record are derived, not asserted:
`tests/site-claims.test.ts` re-derives them from the application's own
credits list and the science docs, and fails when the page and the sources
disagree.

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
per object, so they need a build step that writes inputs rather than a hand
maintained `input` map.
