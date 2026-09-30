/** README.md#request-routing. */

import { legacyShareRedirect, ownedByApp } from './client/util/url-state/share-path-pure';
import { prefersMarkdown } from './negotiation-pure';
import { pageAt, pageRenderedAt, renditionPath, type SitePage } from './site/pages';

export type Route =
  | { kind: 'redirect'; to: string }
  | { kind: 'app' }
  | { kind: 'page'; page: SitePage; rendition: string | null }
  | { kind: 'rendition'; page: SitePage }
  | { kind: 'notFound' };

export function route(pathname: string, search: string): Route {
  const legacy = legacyShareRedirect(pathname, search);
  if (legacy !== null) return { kind: 'redirect', to: legacy };
  if (ownedByApp(pathname)) return { kind: 'app' };
  const page = pageAt(pathname);
  if (page !== null) return { kind: 'page', page, rendition: renditionPath(page) };
  const rendered = pageRenderedAt(pathname);
  if (rendered !== null) return { kind: 'rendition', page: rendered };
  return { kind: 'notFound' };
}

/** The rendition a page request is answered with instead of its HTML, or null. */
export function negotiatedRendition(route: Route, accept: string | null): string | null {
  return route.kind === 'page' && route.rendition !== null && prefersMarkdown(accept)
    ? route.rendition
    : null;
}
