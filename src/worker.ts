// Copyright (C) 2026 Alex Marshall
// SPDX-License-Identifier: AGPL-3.0-only

// Fetcher is inlined rather than imported from @cloudflare/workers-types.
// Adding that package to the tsconfig `types` array bleeds its DOM
// re-declarations into the client types and breaks `querySelector<T>`;
// keeping a minimal local interface sidesteps the leak. Don't swap to
// the type package without a second tsconfig for the worker build.
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
}

// Thin passthrough. The Worker exists so per-request analytics,
// observability logs, and tail are available — pure assets-only deploys
// lose those. With the app at the apex of stellata.xyz there is no path
// prefix to strip; just hand the request to the assets binding.
export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request);
  },
};
