# src/

Cloudflare Worker entry + browser client.

- `worker.ts` — thin Worker entry. Hands every request to
  `env.ASSETS.fetch(request)`. The Worker exists so per-request
  analytics, observability logs, and tail are available — pure
  assets-only deploys lose those features. With the app at the apex of
  `stellata.xyz` there is no path prefix to strip. `wrangler.toml`
  (repo root) drives the deploy; CI workflow lives in
  `.github/workflows/` (see its README).
- `client/` — browser app. See `src/client/README.md`.

## `@cloudflare/workers-types` leaks globally

Do not add it to the tsconfig `types` array — its DOM re-declarations
bleed into the client types and break `querySelector<T>`. `worker.ts`
inlines its own minimal `Fetcher` interface; don't swap back to the
type package without a second tsconfig for the worker build.
