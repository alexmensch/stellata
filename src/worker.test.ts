// The Worker's routing table, against a stubbed assets binding — the two
// rules the built tree cannot express (README § Request routing).

import { describe, expect, it, vi } from 'vitest';
import worker from './worker';

const APP_DOC = 'the application document';
const HOMEPAGE = 'the homepage';

/**
 * An assets binding that answers only the paths a real build emits.
 * Everything else 404s, which is what `not_found_handling = "none"` gives
 * the Worker to work with.
 */
function stubAssets(served: Record<string, string>) {
  return vi.fn(async (request: Request) => {
    const body = served[new URL(request.url).pathname];
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(body, { status: 200 });
  });
}

const BUILT = {
  '/': HOMEPAGE,
  '/app': APP_DOC,
  '/assets/index-abc.js': 'console.log(1)',
  '/catalog.bin.0': 'binary',
};

function get(path: string, init?: RequestInit) {
  return new Request(`https://stellata.xyz${path}`, init);
}

async function route(path: string, init?: RequestInit) {
  const fetchMock = stubAssets(BUILT);
  const response = await worker.fetch(get(path, init), { ASSETS: { fetch: fetchMock } });
  return { response, fetchMock };
}

describe('legacy share transports redirect onto the canonical form', () => {
  it('301s a root-relative share path under /app', async () => {
    const { response } = await route('/v/AQAA/');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://stellata.xyz/app/v/AQAA/');
  });

  it('301s a legacy ?v= query off the homepage and onto the app', async () => {
    const { response } = await route('/?v=AQAA');
    expect(response.status).toBe(301);
    expect(response.headers.get('location')).toBe('https://stellata.xyz/app/?v=AQAA');
  });

  // Permanent, not temporary: the canonical form is what should end up
  // bookmarked, re-shared and indexed.
  it('redirects permanently, and without consulting the assets binding', async () => {
    const { response, fetchMock } = await route('/v/AQAA/');
    expect(response.status).toBe(301);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves a path that merely starts with the letter v alone', async () => {
    const { response } = await route('/vintage');
    expect(response.status).toBe(404);
  });
});

describe('an unmatched path under /app is application state', () => {
  it('serves the application document for a canonical share path', async () => {
    const { response } = await route('/app/v/AQAA/');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(APP_DOC);
  });

  it('serves it for any deeper unmatched path a future route invents', async () => {
    const { response } = await route('/app/whatever/comes/next');
    expect(await response.text()).toBe(APP_DOC);
  });

  it('does not consult the fallback when /app itself matches', async () => {
    const { response, fetchMock } = await route('/app');
    expect(await response.text()).toBe(APP_DOC);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // The fallback is for documents. A write to a path that does not exist is
  // an error, not a request for the app shell.
  it('leaves a non-GET/HEAD miss as a 404', async () => {
    const { response } = await route('/app/v/AQAA/', { method: 'POST' });
    expect(response.status).toBe(404);
  });
});

describe('everything else is served, or really missing', () => {
  it('serves the homepage at the root', async () => {
    const { response } = await route('/');
    expect(await response.text()).toBe(HOMEPAGE);
  });

  it.each(['/assets/index-abc.js', '/catalog.bin.0'])('passes %s through', async (path) => {
    const { response } = await route(path);
    expect(response.status).toBe(200);
  });

  // The whole point of dropping the SPA not_found_handling: an unknown path
  // is a 404, not a 200 carrying the wrong page.
  it.each(['/nonsense', '/science', '/catalog.bin.9'])(
    '404s %s rather than answering with a page',
    async (path) => {
      const { response } = await route(path);
      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).not.toBe(HOMEPAGE);
      expect(body).not.toBe(APP_DOC);
    },
  );

  // `not_found_handling = "404-page"` answers a miss with dist/404.html at a
  // 404 status. Outside /app the Worker must hand that straight back — the
  // designed page is the point, so swallowing the body would leave the
  // status with nothing to render.
  it('passes the 404 page through for a miss outside /app', async () => {
    const notFoundPage = 'the 404 page';
    const fetchMock = vi.fn(
      async () => new Response(notFoundPage, { status: 404 }),
    );
    const response = await worker.fetch(get('/nonsense'), { ASSETS: { fetch: fetchMock } });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe(notFoundPage);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
