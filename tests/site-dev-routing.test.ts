// The dev server's routing table, held against the one `src/worker.ts`
// answers in production. `src/worker.test.ts` pins the deploy side; this
// pins that `pnpm run dev` cannot drift from it.

import { describe, expect, it } from 'vitest';

import { resolve } from 'node:path';

import { publishBuildEnv } from '../vite.env';
import { devRoute, documentRoutingInDev } from '../vite.site-dev';

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

// `devRoute` decides the path; these drive the middleware that answers it,
// which is where the Accept header comes in. A dev server gated on
// `text/html` 404'd the root for every agent fetcher and every `curl` while
// the deploy served it — src/README.md § Request routing.
describe('the middleware answers whatever the client accepts', () => {
  interface Answer {
    status: number;
    headers: Record<string, string>;
    body: string;
    fellThrough: boolean;
  }

  const ROOT = resolve(__dirname, '..');

  const handler = (() => {
    // `vite.config.ts` does this at config load, which is what puts the
    // figures the rendition resolves into the dev server's environment.
    publishBuildEnv(ROOT);
    const registered: ((req: never, res: never, next: never) => unknown)[] = [];
    const plugin = documentRoutingInDev(ROOT);
    const post = plugin.configureServer!({
      middlewares: { use: (fn: never) => registered.push(fn) },
      transformIndexHtml: async (_base: string, html: string) => html,
    } as never) as () => void;
    post();
    return registered[0];
  })();

  async function fetchPath(path: string, accept?: string): Promise<Answer> {
    const answer: Answer = { status: 200, headers: {}, body: '', fellThrough: false };
    const res = {
      set statusCode(code: number) {
        answer.status = code;
      },
      get statusCode() {
        return answer.status;
      },
      setHeader(name: string, value: string) {
        answer.headers[name.toLowerCase()] = value;
      },
      end(body?: string) {
        answer.body = body ?? '';
      },
    };
    const req = { method: 'GET', url: path, originalUrl: path, headers: { accept } };
    await handler(req as never, res as never, ((err?: Error) => {
      if (err !== undefined) throw err;
      answer.fellThrough = true;
    }) as never);
    return answer;
  }

  it.each([
    ['*/*', 'a wildcard, as curl and most agent fetchers send'],
    [undefined, 'no Accept header at all'],
  ])('serves the homepage to %s (%s)', async (accept) => {
    const answer = await fetchPath('/', accept);
    expect(answer.status).toBe(200);
    expect(answer.fellThrough).toBe(false);
    expect(answer.body).toContain('<h1 id="hero-heading">');
  });

  it('serves the application document to a wildcard Accept too', async () => {
    const answer = await fetchPath('/app', '*/*');
    expect(answer.status).toBe(200);
    expect(answer.body).toContain('<canvas');
  });

  it('serves the markdown rendition to a client that asks for it', async () => {
    const answer = await fetchPath('/', 'text/markdown');
    expect(answer.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(answer.headers.vary).toBe('Accept');
    expect(answer.body.split('\n')[0]).toMatch(/^# Stellata/);
    expect(answer.body).not.toContain('<h1');
  });

  it('advertises the rendition on the HTML answer', async () => {
    const answer = await fetchPath('/', 'text/html');
    expect(answer.headers.link).toBe('</index.md>; rel="alternate"; type="text/markdown"');
    expect(answer.headers.vary).toBe('Accept');
  });

  // The app has no rendition, so asking for one gets its document rather
  // than the homepage's markdown.
  it('has no rendition to offer for the application', async () => {
    const answer = await fetchPath('/app', 'text/markdown');
    expect(answer.headers['content-type']).toBe('text/html; charset=utf-8');
  });

  it('serves the 404 page, at a 404, for an unmatched path', async () => {
    const answer = await fetchPath('/nonsense', '*/*');
    expect(answer.status).toBe(404);
  });

  // An explicit non-document Accept is an asset fetch; a miss there is a
  // missing asset, which Vite's own 404 should answer.
  it('lets an asset fetch fall through rather than answering with a page', async () => {
    const answer = await fetchPath('/missing.png', 'image/png');
    expect(answer.fellThrough).toBe(true);
  });

  it('301s a legacy share link whatever the client accepts', async () => {
    const answer = await fetchPath('/v/AQAA/', 'text/markdown');
    expect(answer.status).toBe(301);
    expect(answer.headers.location).toBe('/app/v/AQAA/');
  });
});
