# src/

Cloudflare Worker entry + browser client.

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
- `client/` — browser app.

## `@cloudflare/workers-types` leaks globally

Do not add it to the tsconfig `types` array — its DOM re-declarations
bleed into the client types and break `querySelector<T>`. `worker.ts`
inlines its own minimal `Fetcher` interface; don't swap back to the
type package without a second tsconfig for the worker build.
