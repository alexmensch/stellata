/** Test-only. README.md#request-routing. */

import type { Route } from './routing-pure';

export type ServedDocument = 'app' | 'homepage' | 'rendition' | 'notFound';

export interface RoutingCase {
  pathname: string;
  search: string;
  kind: Route['kind'];
  /** A redirect's target, or the document served. */
  answer: { redirect: string } | { document: ServedDocument };
}

export const ROUTING_CASES: readonly RoutingCase[] = [
  { pathname: '/v/AQAA/', search: '', kind: 'redirect', answer: { redirect: '/app/v/AQAA/' } },
  { pathname: '/v/AQAA', search: '', kind: 'redirect', answer: { redirect: '/app/v/AQAA' } },
  { pathname: '/v/not!valid/', search: '', kind: 'redirect', answer: { redirect: '/app/v/not!valid/' } },
  { pathname: '/', search: '?v=AQAA', kind: 'redirect', answer: { redirect: '/app?v=AQAA' } },
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
];
