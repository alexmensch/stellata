# src/

Cloudflare Worker entry, browser client, and the public content site.

- `worker.ts` — the Worker entry, and the request router. It exists so
  per-request analytics, observability logs, and tail are available —
  pure assets-only deploys lose those features — and it owns the two
  routing rules the built tree cannot express (§ Request routing).
  `wrangler.toml` (repo root) drives the deploy; CI workflow lives in
  `.github/workflows/` (see its README).
- `worker.test.ts` — the routing table against a stubbed assets binding,
  so the rules below are checked without a `wrangler dev`.
- `client/` — browser app, served at `/app`. Built by `vite.config.ts`;
  `client/app/README.md` is why that path and not `/`.
- `site/` — the public content pages, the homepage at `/` among them.
  Authored HTML with no JavaScript, built by `vite.site.config.ts` into
  the same `dist/` **after** the app build, which is the pass that empties
  it. Its README owns the seam.
- `design-tokens.css` — the palette and typeface every surface paints
  from. `client/styles.css` and `site/site.css` each `@import` it and add
  only what is theirs; neither restates a colour.

## Request routing

The built tree mirrors the URL space: `dist/index.html` is `/`, the public
homepage; `dist/app/index.html` is `/app`, the application; and every
artifact and crawler file sits at the root beside them. Cloudflare's
static-assets layer serves all of that directly, matching assets and HTML
before anything else runs. Two things it cannot express, which `worker.ts`
does:

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

**`vite.site-dev.ts` answers this same table**, in this same order, off
the same import — `devRoute` is its whole routing decision and
`tests/site-dev-routing.test.ts` pins it beside `worker.test.ts`. The
dev server restating the rules is how it came to 404 a share link the
deploy redirects, which nobody sees until someone pastes a real URL.

**`not_found_handling` is deliberately `"404-page"`, not
`"single-page-application"`.** As the latter it answered every unmatched
path with the *root* `index.html`, which is now the homepage: a share link
would have served marketing, and every typo a 200. It now serves
`dist/404.html` (built from `src/site/404.html`) with a real 404 status.

One consequence is worth knowing before touching a loader — **a missing
artifact now arrives as a real 404** rather than as HTML that fails to
parse. Every optional loader already answers `!res.ok` with null, so
absence is handled on the direct path; the parse-error branch still covers
a present-but-truncated artifact. Note the 404 page *is* an HTML body, so
a loader that ignored status and only guarded the parse would still be
wrong — for a different reason than before.

## `@cloudflare/workers-types` leaks globally

Do not add it to the tsconfig `types` array — its DOM re-declarations
bleed into the client types and break `querySelector<T>`. `worker.ts`
inlines its own minimal `Fetcher` interface; don't swap back to the
type package without a second tsconfig for the worker build.
