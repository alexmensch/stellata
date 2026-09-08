# src/

Cloudflare Worker entry, browser client, and the public content site.

- `worker.ts` — thin Worker entry. Hands every request to
  `env.ASSETS.fetch(request)` and does no routing. The Worker exists so
  per-request analytics, observability logs, and tail are available —
  pure assets-only deploys lose those features. Share links live at
  `/v/<blob>/` (see `client/util/url-state/README.md`); those paths
  aren't real asset files, so `wrangler.toml`'s `[assets]
  not_found_handling = "single-page-application"` serves `index.html`
  (200) for any unmatched path, and `env.ASSETS.fetch` honors it.
  `wrangler.toml` (repo root) drives the deploy; CI workflow lives in
  `.github/workflows/` (see its README).
- `client/` — browser app, served at `/`. Built by `vite.config.ts`.
- `site/` — the public content pages (`/home` today), authored HTML with
  no JavaScript. Built by `vite.site.config.ts` into the same `dist/`
  **after** the app build, which is the pass that empties it. Its README
  owns the seam.
- `design-tokens.css` — the palette and typeface every surface paints
  from. `client/styles.css` and `site/site.css` each `@import` it and add
  only what is theirs; neither restates a colour.

## `@cloudflare/workers-types` leaks globally

Do not add it to the tsconfig `types` array — its DOM re-declarations
bleed into the client types and break `querySelector<T>`. `worker.ts`
inlines its own minimal `Fetcher` interface; don't swap back to the
type package without a second tsconfig for the worker build.
