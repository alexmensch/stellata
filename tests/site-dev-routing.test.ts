// The dev server's routing table, held against the one `src/worker.ts`
// answers in production. `src/worker.test.ts` pins the deploy side; this
// pins that `pnpm run dev` cannot drift from it.

import { describe, expect, it } from 'vitest';

import { devRoute } from '../vite.site-dev';

describe('the dev server answers the deploy’s routing table', () => {
  it('301s both legacy share transports onto the canonical form', () => {
    expect(devRoute('/v/AQAA/', '')).toEqual({ kind: 'redirect', to: '/app/v/AQAA/' });
    expect(devRoute('/v/AQAA', '')).toEqual({ kind: 'redirect', to: '/app/v/AQAA' });
    expect(devRoute('/', '?v=AQAA')).toEqual({ kind: 'redirect', to: '/app/?v=AQAA' });
  });

  // The redirect never parses the blob, so schema version and decodability
  // are irrelevant to it — a v1 link and an unreadable one both land on the
  // app, which strips the bar itself.
  it('redirects a blob it cannot read', () => {
    expect(devRoute('/v/not!valid/', '')).toEqual({ kind: 'redirect', to: '/app/v/not!valid/' });
  });

  it.each(['/app', '/app/', '/app/v/AQAA/', '/app/anything'])(
    'serves the application document for %s',
    (pathname) => {
      expect(devRoute(pathname, '')).toEqual({ kind: 'document', doc: 'app' });
    },
  );

  it('serves the homepage for the root alone', () => {
    expect(devRoute('/', '')).toEqual({ kind: 'document', doc: 'home' });
    expect(devRoute('/', '?utm=x')).toEqual({ kind: 'document', doc: 'home' });
  });

  it.each(['/nonsense', '/science', '/vintage', '/apple'])(
    'serves the 404 page for %s',
    (pathname) => {
      expect(devRoute(pathname, '')).toEqual({ kind: 'document', doc: 'notFound' });
    },
  );
});
