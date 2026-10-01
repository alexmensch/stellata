import { describe, expect, it } from 'vitest';

import { ROUTING_CASES } from './routing-cases-fixture';
import { negotiatedRendition, route } from './routing-pure';

describe('route', () => {
  it.each(ROUTING_CASES)('decides $pathname $search is $kind', ({ pathname, search, kind, answer }) => {
    const decided = route(pathname, search);
    expect(decided.kind).toBe(kind);
    if ('redirect' in answer) expect(decided).toEqual({ kind: 'redirect', to: answer.redirect, status: answer.status });
  });

  it('carries the page’s rendition beside it', () => {
    expect(route('/', '')).toMatchObject({ kind: 'page', page: { source: 'index.html' }, rendition: '/index.md' });
  });
});

describe('negotiatedRendition', () => {
  it('answers the homepage’s rendition to a client that names markdown', () => {
    expect(negotiatedRendition(route('/', ''), 'text/markdown')).toBe('/index.md');
  });

  it('answers none to a browser', () => {
    expect(negotiatedRendition(route('/', ''), 'text/html,*/*;q=0.8')).toBeNull();
  });

  it.each(['/app', '/app/v/AQAA/', '/index.md', '/science'])(
    'answers none for %s, which is not a page with one',
    (pathname) => {
      expect(negotiatedRendition(route(pathname, ''), 'text/markdown')).toBeNull();
    },
  );
});
