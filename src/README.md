# src/

Cloudflare Worker entry, browser client, and the public content site.

- `worker.ts` — the Worker entry, and the request router. It exists so
  per-request analytics, observability logs, and tail are available —
  pure assets-only deploys lose those features — and it owns the three
  routing rules the built tree cannot express ([Request routing](#request-routing)).
  `wrangler.toml` (repo root) drives the deploy; CI workflow lives in
  `.github/workflows/` (see its README).
- `worker.test.ts` — the routing table against a stubbed assets binding,
  so the rules below are checked without a `wrangler dev`.
- `worker-assets-layer.test.ts` — the same rules behind Cloudflare's real
  assets layer: wrangler's local runtime booted from `wrangler.toml` over a
  fixture build, with a browser's navigation header. It is what fails when a
  `[assets]` key below is dropped; skips only where that runtime cannot
  start.
- `negotiation-pure.ts` — which rendition of a page an `Accept` header
  asks for, and the headers that advertise it; which pages have one is
  `site/pages.ts`'s. Imported by
  `worker.ts` and by `../vite.site-dev.ts`, so the deploy and the dev
  server cannot answer differently.
- `client/` — browser app, served at `/app`. Built by `vite.config.ts`;
  `client/app/README.md` is why that path and not `/`.
- `site/` — the public content pages, the homepage at `/` among them.
  Authored HTML with no JavaScript, built by `vite.site.config.ts` into
  the same `dist/` **after** the app build, which is the pass that empties
  it. Its README owns the seam.
- `design-tokens.css` — the palette and typeface every surface paints
  from. `client/styles.css` and `site/styles/site.css` each `@import` it and add
  only what is theirs; neither restates a colour.

## Request routing

The built tree mirrors the URL space: `dist/index.html` is `/`, the public
homepage; `dist/app/index.html` is `/app`, the application; and every
artifact and crawler file sits at the root beside them. Cloudflare's
static-assets layer serves all of that directly. Three things it cannot
express, which `worker.ts` does:

- **An unmatched path under `/app` is application state, not a miss.** A
  share link is `/app/v/<blob>/` — no such asset exists, and the blob is
  the client's to decode. The Worker probes the assets binding first and
  falls back to the application document on a 404, so a real asset ever
  emitted under `/app` keeps winning.
- **Both legacy share transports 301 onto the canonical form.**
  `/v/<blob>/` is the form shared while the application was the site root;
  `/?v=<blob>` predates that one. Links carrying either sit in places that
  can never be edited, so both are answered forever.
  `client/util/url-state/share-path-pure.ts` owns the grammar and the
  Worker imports it — a second spelling of `/app` here would break every
  share link silently. Neither rule inspects the blob: it is redirected
  whatever schema version it carries and whether or not it decodes, which
  is what makes the transport's reach and the decoder's reach the same
  thing (v1 onward, `client/util/url-state/README.md`).
- **A client that names `text/markdown` gets the page's markdown
  rendition.** `/` answers with `dist/index.md` — cheaper to read, and
  read verbatim where an HTML fetch is re-summarised by whatever converted
  it. `negotiation-pure.ts` owns the rule and [The markdown rendition](site/README.md#the-markdown-rendition--how-an-agent-reads-these-pages) owns the why. Three consequences worth knowing:
  a wildcard `Accept` still gets HTML, so no browser or existing crawler
  changes behaviour; both renditions carry `Vary: Accept`, without which a
  cache would serve one to the other; and a rendition that is somehow
  absent falls through to the HTML rather than 404ing the page.

**`vite.site-dev.ts` answers this same table**, in this same order, off
the same import — `devRoute` is its whole routing decision and
`tests/site-dev-routing.test.ts` pins it beside `worker.test.ts`. A dev
server that restates a rule instead answers a share link differently from
the deploy, and nobody sees it until someone pastes a real URL.

### The three `[assets]` keys the rules depend on

**`run_worker_first` names every path a rule above answers** — `/`, `/v`,
`/v/*`, `/app`, `/app/*`. By default the assets layer answers first: a path
that matches an asset (`/` is `dist/index.html`) never reaches the Worker,
and a browser navigation (`Sec-Fetch-Mode: navigate`) to a path matching
none is handed the 404 page without the Worker running either. Drop a
pattern and its rule stops firing for real browsers while `curl` and
`worker.test.ts` still pass — `worker-assets-layer.test.ts` is the suite
that catches it.

**`html_handling` is `"drop-trailing-slash"`**, so a folder's
`index.html` answers at the bare path: `/app`, never `/app/`. Under the
default `"auto-trailing-slash"` `/app` is a 307 to `/app/`, which makes the
canonical URL, the sitemap and every link a redirect, and turns the
Worker's own fallback fetch of `/app` into a redirect that drops the share
path. `APP_PATH` and `site/pages.ts`'s `pagePath` both spell paths this
way.

**`not_found_handling` is `"404-page"`, never
`"single-page-application"`.** The latter answers every unmatched path with
the *root* `index.html`, which is the homepage: a share link would serve
marketing, and every typo a 200. `"404-page"` serves `dist/404.html` (built
from `src/site/404.html`) with a real 404 status.

One consequence is worth knowing before touching a loader — **a missing
artifact arrives as a real 404**. Every optional loader answers `!res.ok`
with null, so absence is handled on the direct path; the parse-error branch
covers a present-but-truncated artifact. The 404 page *is* an HTML body, so
a loader that ignored status and only guarded the parse would be wrong.

## `@cloudflare/workers-types` leaks globally

Do not add it to the tsconfig `types` array — its DOM re-declarations
bleed into the client types and break `querySelector<T>`. `worker.ts`
inlines its own minimal `Fetcher` interface; don't swap back to the
type package without a second tsconfig for the worker build.
