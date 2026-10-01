/** Test-only. README.md#request-routing. */

import type { RedirectStatus, Route } from './routing-pure';

export type ServedDocument = 'app' | 'homepage' | 'rendition' | 'notFound';

export interface RoutingCase {
  pathname: string;
  search: string;
  kind: Route['kind'];
  /** A redirect's target, or the document served. */
  answer: { redirect: string; status: RedirectStatus } | { document: ServedDocument };
}

export const ROUTING_CASES: readonly RoutingCase[] = [
  { pathname: '/v/AQAA/', search: '', kind: 'redirect', answer: { redirect: '/app/v/AQAA/', status: 301 } },
  { pathname: '/v/AQAA', search: '', kind: 'redirect', answer: { redirect: '/app/v/AQAA', status: 301 } },
  { pathname: '/v/not!valid/', search: '', kind: 'redirect', answer: { redirect: '/app/v/not!valid/', status: 301 } },
  { pathname: '/', search: '?v=AQAA', kind: 'redirect', answer: { redirect: '/app/v/AQAA/', status: 301 } },
  { pathname: '/', search: '?v=not!valid', kind: 'redirect', answer: { redirect: '/app?v=not!valid', status: 301 } },
  { pathname: '/app', search: '', kind: 'app', answer: { document: 'app' } },
  { pathname: '/app/', search: '', kind: 'app', answer: { document: 'app' } },
  { pathname: '/app/v/AQAA/', search: '', kind: 'app', answer: { document: 'app' } },
  { pathname: '/app/whatever/comes/next', search: '', kind: 'app', answer: { document: 'app' } },
  { pathname: '/', search: '', kind: 'page', answer: { document: 'homepage' } },
  { pathname: '/', search: '?utm=x', kind: 'page', answer: { document: 'homepage' } },
  { pathname: '/index.md', search: '', kind: 'rendition', answer: { document: 'rendition' } },
  { pathname: '/nonsense', search: '', kind: 'notFound', answer: { document: 'notFound' } },
  { pathname: '/science', search: '', kind: 'notFound', answer: { document: 'notFound' } },
  { pathname: '/vintage', search: '', kind: 'notFound', answer: { document: 'notFound' } },
  { pathname: '/apple', search: '', kind: 'notFound', answer: { document: 'notFound' } },
  { pathname: '/404', search: '', kind: 'notFoundPage', answer: { document: 'notFound' } },
  { pathname: '/404.html', search: '', kind: 'redirect', answer: { redirect: '/404', status: 307 } },
  { pathname: '/index.html', search: '?utm=x', kind: 'redirect', answer: { redirect: '/?utm=x', status: 307 } },
  { pathname: '/app/index.html', search: '', kind: 'redirect', answer: { redirect: '/app', status: 307 } },
];
