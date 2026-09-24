// Copyright (C) 2026 Alex Marshall
// SPDX-License-Identifier: AGPL-3.0-only

import { APP_PATH, legacyShareRedirect, ownedByApp } from './client/util/url-state/share-path-pure';
import {
  MARKDOWN_TYPE,
  alternateLink,
  markdownRendition,
  prefersMarkdown,
  varyWithAccept,
} from './negotiation-pure';

// Inlined, not imported: README.md § `@cloudflare/workers-types` leaks globally.
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
}

function withHeaders(response: Response, edit: (headers: Headers) => void): Response {
  const headers = new Headers(response.headers);
  edit(headers);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const legacy = legacyShareRedirect(url.pathname, url.search);
    if (legacy !== null) {
      return Response.redirect(new URL(legacy, url).toString(), 301);
    }

    const readable = request.method === 'GET' || request.method === 'HEAD';
    const rendition = markdownRendition(url.pathname);

    if (rendition !== null && readable && prefersMarkdown(request.headers.get('accept'))) {
      const markdown = await env.ASSETS.fetch(
        new Request(new URL(rendition, url).toString(), request),
      );
      if (markdown.status === 200) {
        return withHeaders(markdown, (headers) => {
          headers.set('content-type', MARKDOWN_TYPE);
          headers.set('vary', varyWithAccept(headers.get('vary')));
        });
      }
    }

    const response = await env.ASSETS.fetch(request);

    if (rendition !== null && response.status === 200) {
      return withHeaders(response, (headers) => {
        headers.set('link', alternateLink(rendition));
        headers.set('vary', varyWithAccept(headers.get('vary')));
      });
    }

    // The assets layer's type for `.md` is not one it promises.
    if (url.pathname.endsWith('.md') && response.status === 200) {
      return withHeaders(response, (headers) => headers.set('content-type', MARKDOWN_TYPE));
    }

    // After the probe, so a real asset under /app keeps winning.
    if (response.status === 404 && ownedByApp(url.pathname) && readable) {
      return env.ASSETS.fetch(new Request(new URL(APP_PATH, url).toString(), request));
    }

    return response;
  },
};
