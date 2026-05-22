# Deployment

Cloudflare Workers static-assets site. Notes on the worker build and
Wrangler configuration.

## Files in this area

```
src/worker.ts                     Cloudflare Worker entry; thin
                                  passthrough to env.ASSETS.fetch().
                                  Inlines its own minimal Fetcher
                                  interface — see § @cloudflare/workers-types
                                  leaks globally.
wrangler.toml                     Wrangler config: custom_domain,
                                  observability (logs + traces),
                                  compatibility_date, smart placement.
.github/workflows/deploy.yml      Deploy workflow on main; extracts the
                                  ## Release notes block from the merged
                                  PR and posts to the GitHub release.
.github/workflows/release-notes-guard.yml
                                  CI check that fails a PR if the
                                  ## Release notes block is empty
                                  (HTML comments don't count). Skipped
                                  for PRs labelled skip-version-bump.
```

## Why a Worker (vs assets-only)

`src/worker.ts` is a thin passthrough that hands every request to
`env.ASSETS.fetch(request)`. The Worker exists so per-request analytics,
observability logs, and tail are available — pure assets-only deploys
lose those features. With the app at the apex of `stellata.xyz` there is
no path prefix to strip.

## `@cloudflare/workers-types` leaks globally

Do not add it to the tsconfig `types` array — its DOM re-declarations bleed
into the client types and break `querySelector<T>`. `src/worker.ts` currently
inlines its own minimal `Fetcher` interface; don't swap back to the type
package without a second tsconfig for the worker build.

## Wrangler config: observability + smart placement

`wrangler.toml` currently has `placement = { mode = "smart" }` and an
`[observability]` block split into `[observability.logs]` (enabled,
persisted, 10% head sampling, with invocation logs) and
`[observability.traces]` (defined but disabled). The top-level
`[observability]` block must keep `head_sampling_rate` defined for the
deployment to accept the nested subsection config — wrangler treats the
top-level field as the default applied when sub-blocks omit their own
rate.

`compatibility_date` is pinned to `2026-04-22`. Bump deliberately when you
need new runtime features; `wrangler deploy` will log that it's overriding
whatever the dashboard has.

## Custom domain (auto DNS)

`routes` uses `custom_domain = true`, so wrangler creates the proxied DNS
record for the apex automatically — no manual A/AAAA setup. The zone
`stellata.xyz` must already exist in the Cloudflare account.

`routes` must appear **before** `[assets]` in the TOML — TOML sections
claim every line after them until the next section header, so a top-level
array after a `[section]` would be parsed as part of that section.
