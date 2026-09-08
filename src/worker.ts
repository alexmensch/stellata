// Copyright (C) 2026 Alex Marshall
// SPDX-License-Identifier: AGPL-3.0-only

import { APP_PATH, legacyShareRedirect } from './client/util/url-state/share-path-pure';

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

function ownedByApp(pathname: string): boolean {
  return pathname === APP_PATH || pathname.startsWith(`${APP_PATH}/`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const legacy = legacyShareRedirect(url.pathname, url.search);
    if (legacy !== null) {
      return Response.redirect(new URL(legacy, url).toString(), 301);
    }

    const response = await env.ASSETS.fetch(request);

    // A path under /app matching no asset is application state — a share
    // blob, or whatever a future client route invents — so it gets the
    // application document. Probing first rather than pattern-matching
    // means a real asset ever emitted under /app keeps winning.
    if (
      response.status === 404 &&
      ownedByApp(url.pathname) &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      return env.ASSETS.fetch(new Request(new URL(APP_PATH, url).toString(), request));
    }

    return response;
  },
};
