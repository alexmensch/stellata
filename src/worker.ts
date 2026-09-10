// Copyright (C) 2026 Alex Marshall
// SPDX-License-Identifier: AGPL-3.0-only

import { APP_PATH, legacyShareRedirect } from './client/util/url-state/share-path-pure';
import { MARKDOWN_TYPE, markdownRendition, prefersMarkdown } from './negotiation-pure';

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

/** `Accept` now changes what a page answers, so every cache between here and
 *  the reader has to know that. Merged rather than set: an asset response
 *  arriving with a Vary of its own keeps it. */
function varyOnAccept(headers: Headers): void {
  const existing = (headers.get('vary') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
  if (!existing.some((name) => name.toLowerCase() === 'accept')) {
    headers.set('vary', [...existing, 'Accept'].join(', '));
  }
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

    // A client that named `text/markdown` gets the page's markdown rendition
    // instead of its HTML — cheaper to read and read verbatim, where an HTML
    // fetch is re-summarised by whatever converted it. A rendition that is
    // somehow absent falls through to the HTML rather than 404ing the page.
    if (rendition !== null && readable && prefersMarkdown(request.headers.get('accept'))) {
      const markdown = await env.ASSETS.fetch(
        new Request(new URL(rendition, url).toString(), request),
      );
      if (markdown.status === 200) {
        return withHeaders(markdown, (headers) => {
          headers.set('content-type', MARKDOWN_TYPE);
          varyOnAccept(headers);
        });
      }
    }

    const response = await env.ASSETS.fetch(request);

    // The HTML answer to a path that has a rendition advertises it, for a
    // client that reads headers rather than the document.
    if (rendition !== null && response.status === 200) {
      return withHeaders(response, (headers) => {
        headers.set('link', `<${rendition}>; rel="alternate"; type="text/markdown"`);
        varyOnAccept(headers);
      });
    }

    // Cloudflare's assets layer types a `.md` file by extension, which is not
    // a promise it makes. The rendition's content type decides whether a
    // client reads it or downloads it, so it is stamped here either way.
    if (url.pathname.endsWith('.md') && response.status === 200) {
      return withHeaders(response, (headers) => headers.set('content-type', MARKDOWN_TYPE));
    }

    // A path under /app matching no asset is application state — a share
    // blob, or whatever a future client route invents — so it gets the
    // application document. Probing first rather than pattern-matching
    // means a real asset ever emitted under /app keeps winning.
    if (response.status === 404 && ownedByApp(url.pathname) && readable) {
      return env.ASSETS.fetch(new Request(new URL(APP_PATH, url).toString(), request));
    }

    return response;
  },
};
