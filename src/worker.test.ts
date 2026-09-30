// The Worker's routing table, against a stubbed assets binding — the rules the
// built tree cannot express (README.md#request-routing).

import { describe, expect, it, vi } from 'vitest';
import { ROUTING_CASES, type ServedDocument } from './routing-cases-fixture';
import worker from './worker';

const DOCUMENTS: Record<ServedDocument, string> = {
  app: 'the application document',
  homepage: 'the homepage',
  rendition: '# the homepage, as markdown',
  notFound: 'the 404 page',
};

/**
 * An assets binding that answers only the paths a real build emits, and the
 * 404 page at a 404 for everything else — `not_found_handling = "404-page"`.
 */
function stubAssets(served: Record<string, string>) {
  return vi.fn(async (request: Request) => {
    const body = served[new URL(request.url).pathname];
    return body === undefined
      ? new Response(DOCUMENTS.notFound, { status: 404 })
      : new Response(body, { status: 200 });
  });
}

const BUILT = {
  '/': DOCUMENTS.homepage,
  '/index.md': DOCUMENTS.rendition,
  '/app': DOCUMENTS.app,
  '/assets/index-abc.js': 'console.log(1)',
  '/catalog.bin.0': 'binary',
};

const MARKDOWN = { headers: { accept: 'text/markdown' } };
const BROWSER = {
  headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
};

function get(path: string, init?: RequestInit) {
  return new Request(`https://stellata.xyz${path}`, init);
}

async function route(path: string, init?: RequestInit) {
  const fetchMock = stubAssets(BUILT);
  const response = await worker.fetch(get(path, init), { ASSETS: { fetch: fetchMock } });
  return { response, fetchMock };
}

describe('the routing table', () => {
  it.each(ROUTING_CASES)('answers $pathname $search', async ({ pathname, search, answer }) => {
    const { response } = await route(pathname + search, BROWSER);
    if ('redirect' in answer) {
      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe(`https://stellata.xyz${answer.redirect}`);
    } else {
      expect(response.status).toBe(answer.document === 'notFound' ? 404 : 200);
      expect(await response.text()).toBe(DOCUMENTS[answer.document]);
    }
  });
});

describe('legacy share transports redirect onto the canonical form', () => {
  // Permanent, not temporary: the canonical form is what should end up
  // bookmarked, re-shared and indexed.
  it('redirects permanently, and without consulting the assets binding', async () => {
    const { response, fetchMock } = await route('/v/AQAA/');
    expect(response.status).toBe(301);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('an unmatched path under /app is application state', () => {
  it('does not consult the fallback when /app itself matches', async () => {
    const { response, fetchMock } = await route('/app');
    expect(await response.text()).toBe(DOCUMENTS.app);
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
  it.each(['/assets/index-abc.js', '/catalog.bin.0'])('passes %s through', async (path) => {
    const { response } = await route(path);
    expect(response.status).toBe(200);
  });

  it('404s an artifact the build did not emit', async () => {
    const { response } = await route('/catalog.bin.9');
    expect(response.status).toBe(404);
  });
});

// The rendition is what an agent client reads instead of re-summarising the
// HTML. `negotiation-pure.test.ts` pins which Accept headers ask for it; this
// pins that asking gets it, and that the caches in between are told.
describe('a client that asks for markdown gets the page’s rendition', () => {
  it('serves the rendition at the root', async () => {
    const { response } = await route('/', MARKDOWN);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(DOCUMENTS.rendition);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });

  it('tells every cache in between that Accept decided it', async () => {
    const { response } = await route('/', MARKDOWN);
    expect(response.headers.get('vary')).toMatch(/\bAccept\b/);
  });

  it('still serves HTML to a browser, and says the rendition exists', async () => {
    const { response } = await route('/', BROWSER);
    expect(await response.text()).toBe(DOCUMENTS.homepage);
    expect(response.headers.get('link')).toBe(
      '</index.md>; rel="alternate"; type="text/markdown"',
    );
    expect(response.headers.get('vary')).toMatch(/\bAccept\b/);
  });

  it('types the rendition as markdown when fetched by its own path', async () => {
    const { response } = await route('/index.md');
    expect(await response.text()).toBe(DOCUMENTS.rendition);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
  });

  // The application is a script that renders a canvas; there is no rendition
  // of it to serve, and answering with the homepage's would be a lie.
  it.each(['/app', '/app/v/AQAA/'])('has none to offer for %s', async (path) => {
    const { response } = await route(path, MARKDOWN);
    expect(await response.text()).toBe(DOCUMENTS.app);
  });

  // A build that emitted the page but not its rendition must still serve the
  // page. The rendition is an optimisation, never a precondition.
  it('falls back to the HTML when the rendition is missing', async () => {
    const fetchMock = stubAssets({ '/': DOCUMENTS.homepage });
    const response = await worker.fetch(get('/', MARKDOWN), { ASSETS: { fetch: fetchMock } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(DOCUMENTS.homepage);
  });

  it('leaves a legacy share link redirecting, whatever it asked for', async () => {
    const { response } = await route('/v/AQAA/', MARKDOWN);
    expect(response.status).toBe(301);
  });
});
