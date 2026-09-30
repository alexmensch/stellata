// Copyright (C) 2026 Alex Marshall
// SPDX-License-Identifier: AGPL-3.0-only

import { APP_PATH } from './client/util/url-state/share-path-pure';
import { MARKDOWN_TYPE, alternateLink, varyWithAccept, wantsDocument } from './negotiation-pure';
import { negotiatedRendition, route } from './routing-pure';

// Inlined, not imported: README.md#cloudflareworkers-types-leaks-globally.
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
}

/** A 304 is the same answer revalidated, and carries the same Vary. */
function served(response: Response): boolean {
  return response.status === 200 || response.status === 304;
}

function withHeaders(response: Response, edit: (headers: Headers) => void): Response {
  const headers = new Headers(response.headers);
  edit(headers);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const decided = route(url.pathname, url.search);

    const readable = request.method === 'GET' || request.method === 'HEAD';

    if (decided.kind === 'redirect' && readable) {
      return Response.redirect(new URL(decided.to, url).toString(), decided.status);
    }

    const accept = request.headers.get('accept');
    const rendition = readable ? negotiatedRendition(decided, accept) : null;

    if (rendition !== null) {
      const markdown = await env.ASSETS.fetch(
        new Request(new URL(rendition, url).toString(), request),
      );
      if (served(markdown)) {
        return withHeaders(markdown, (headers) => {
          headers.set('content-type', MARKDOWN_TYPE);
          headers.set('vary', varyWithAccept(headers.get('vary')));
        });
      }
    }

    const response = await env.ASSETS.fetch(request);

    if (decided.kind === 'page' && decided.rendition !== null && served(response)) {
      const advertised = decided.rendition;
      return withHeaders(response, (headers) => {
        headers.set('link', alternateLink(advertised));
        headers.set('vary', varyWithAccept(headers.get('vary')));
      });
    }

    // After the probe, so a real asset under /app keeps winning.
    if (response.status === 404 && decided.kind === 'app' && readable && wantsDocument(accept)) {
      return env.ASSETS.fetch(new Request(new URL(APP_PATH, url).toString(), request));
    }

    if (decided.kind === 'notFoundPage' && response.status === 200) {
      return new Response(response.body, { status: 404, headers: response.headers });
    }

    return response;
  },
};
