/** README.md#request-routing. */

import { APP_PATH, legacyShareRedirect, ownedByApp } from './client/util/url-state/share-path-pure';
import { prefersMarkdown } from './negotiation-pure';
import {
  NOT_FOUND_SOURCE,
  SITE_PAGES,
  pageAt,
  pageRenderedAt,
  renditionPath,
  servedPath,
  type SitePage,
} from './site/pages';

/** A legacy share link moves for good; a document's file path is only an alias, as the assets layer answers it. */
export type RedirectStatus = 301 | 307;

export type Route =
  | { kind: 'redirect'; to: string; status: RedirectStatus }
  | { kind: 'app' }
  | { kind: 'page'; page: SitePage; rendition: string | null }
  | { kind: 'rendition'; page: SitePage }
  | { kind: 'notFoundPage' }
  | { kind: 'notFound' };

const DOCUMENT_SOURCES = [
  ...SITE_PAGES.map((page) => page.source),
  NOT_FOUND_SOURCE,
  `${APP_PATH.slice(1)}/index.html`,
];

function documentAlias(pathname: string): string | null {
  const source = DOCUMENT_SOURCES.find((candidate) => `/${candidate}` === pathname);
  return source === undefined ? null : servedPath(source);
}

export function route(pathname: string, search: string): Route {
  const legacy = legacyShareRedirect(pathname, search);
  if (legacy !== null) return { kind: 'redirect', to: legacy, status: 301 };
  const alias = documentAlias(pathname);
  if (alias !== null) return { kind: 'redirect', to: alias + search, status: 307 };
  if (ownedByApp(pathname)) return { kind: 'app' };
  const page = pageAt(pathname);
  if (page !== null) return { kind: 'page', page, rendition: renditionPath(page) };
  const rendered = pageRenderedAt(pathname);
  if (rendered !== null) return { kind: 'rendition', page: rendered };
  if (pathname === servedPath(NOT_FOUND_SOURCE)) return { kind: 'notFoundPage' };
  return { kind: 'notFound' };
}

/** The rendition a page request is answered with instead of its HTML, or null. */
export function negotiatedRendition(route: Route, accept: string | null): string | null {
  return route.kind === 'page' && route.rendition !== null && prefersMarkdown(accept)
    ? route.rendition
    : null;
}
