// The dev server's routing table, held against the one `src/worker.ts`
// answers in production: both run `src/routing-cases-fixture.ts`.

import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ROUTING_CASES, type ServedDocument } from '../src/routing-cases-fixture';
import { documentRoutingInDev } from '../vite.site-dev';

const ROOT = resolve(__dirname, '..');
const titleOf = (source: string) =>
  /<title>[^<]*<\/title>/.exec(readFileSync(resolve(ROOT, source), 'utf8'))![0];
const HOME_TITLE = titleOf('src/site/index.html');

/** What identifies each served document in the dev server's real output. */
const IDENTIFIED_BY: Record<ServedDocument, (body: string) => boolean> = {
  app: (body) => body.includes('<canvas'),
  homepage: (body) => body.includes(HOME_TITLE),
  rendition: (body) => body.startsWith('# '),
  notFound: (body) => body.includes(titleOf('src/site/404.html')),
};

interface Server {
  handler: (req: never, res: never, next: never) => unknown;
  watched: string[];
  change: (file: string) => void;
  sent: { type: string; path?: string }[];
}

function start(): Server {
  const registered: ((req: never, res: never, next: never) => unknown)[] = [];
  const watched: string[] = [];
  const changed: ((file: string) => void)[] = [];
  const sent: { type: string; path?: string }[] = [];
  const plugin = documentRoutingInDev(ROOT);
  const post = plugin.configureServer!({
    middlewares: { use: (fn: never) => registered.push(fn) },
    transformIndexHtml: async (_base: string, html: string) => html,
    watcher: {
      add: (path: string) => watched.push(path),
      on: (event: string, fn: (file: string) => void) => {
        if (event === 'change') changed.push(fn);
      },
    },
    hot: { send: (payload: { type: string }) => sent.push(payload) },
  } as never) as () => void;
  post();
  return {
    handler: registered[0],
    watched,
    change: (file) => changed.forEach((fn) => fn(file)),
    sent,
  };
}

interface Answer {
  status: number;
  headers: Record<string, string>;
  body: string;
  fellThrough: boolean;
}

const { handler } = start();

async function fetchPath(path: string, accept?: string, method = 'GET'): Promise<Answer> {
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
    getHeader(name: string) {
      return answer.headers[name.toLowerCase()];
    },
    end(body?: string) {
      answer.body = body ?? '';
    },
  };
  const req = { method, url: path, originalUrl: path, headers: { accept } };
  await handler(req as never, res as never, ((err?: Error) => {
    if (err !== undefined) throw err;
    answer.fellThrough = true;
  }) as never);
  return answer;
}

describe('the dev server answers the deploy’s routing table', () => {
  it.each(ROUTING_CASES)('answers $pathname $search', async ({ pathname, search, answer }) => {
    const served = await fetchPath(pathname + search, 'text/html');
    if ('redirect' in answer) {
      expect(served.status).toBe(answer.status);
      expect(served.headers.location).toBe(answer.redirect);
    } else {
      expect(served.status).toBe(answer.document === 'notFound' ? 404 : 200);
      expect(IDENTIFIED_BY[answer.document](served.body)).toBe(true);
    }
  });
});

describe('the middleware answers whatever the client accepts', () => {
  it.each([
    ['*/*', 'a wildcard, as curl and most agent fetchers send'],
    [undefined, 'no Accept header at all'],
  ])('serves the homepage to %s (%s)', async (accept) => {
    const answer = await fetchPath('/', accept);
    expect(answer.status).toBe(200);
    expect(answer.fellThrough).toBe(false);
    expect(answer.body).toContain(HOME_TITLE);
  });

  it('routes every file beside a site page through the filesystem', async () => {
    const { body } = await fetchPath('/', 'text/html');
    const siteDir = resolve(ROOT, 'src/site');
    expect(body).toContain(`href="/@fs${siteDir}/styles/site.css"`);
    expect(body).toContain(`src="/@fs${siteDir}/replay.ts"`);
    expect(body).not.toMatch(/(src|href)="\.\//);
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

  it('serves the rendition the HTML answer advertises', async () => {
    const answer = await fetchPath('/index.md', '*/*');
    expect(answer.status).toBe(200);
    expect(answer.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(answer.body.startsWith('# ')).toBe(true);
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

  it('keeps the whole query on a redirect, as the Worker’s URL parse does', async () => {
    const answer = await fetchPath('/?v=AQAA&x=a?b', 'text/html');
    expect(answer.headers.location).toBe('/app?v=AQAA&x=a?b');
  });

  it('redirects only a GET or HEAD, as the Worker does', async () => {
    expect((await fetchPath('/v/AQAA/', 'text/html', 'HEAD')).status).toBe(301);
    expect((await fetchPath('/v/AQAA/', 'text/html', 'POST')).fellThrough).toBe(true);
  });

  it('301s a legacy share link whatever the client accepts', async () => {
    const answer = await fetchPath('/v/AQAA/', 'text/markdown');
    expect(answer.status).toBe(301);
    expect(answer.headers.location).toBe('/app/v/AQAA/');
  });
});

describe('an edit to a page reloads the browser', () => {
  it('watches the folder the pages are in', () => {
    expect(start().watched).toContain(resolve(ROOT, 'src/site'));
  });

  it('reloads on a page edit', () => {
    const server = start();
    server.change(resolve(ROOT, 'src/site/index.html'));
    expect(server.sent).toEqual([{ type: 'full-reload', path: '*' }]);
  });

  it('reloads on an edit to a page in a subfolder', () => {
    const server = start();
    server.change(resolve(ROOT, 'src/site/science/index.html'));
    expect(server.sent).toEqual([{ type: 'full-reload', path: '*' }]);
  });

  it('leaves the stylesheet to Vite’s own css update', () => {
    const server = start();
    server.change(resolve(ROOT, 'src/site/styles/site.css'));
    expect(server.sent).toEqual([]);
  });

  it('ignores a document elsewhere in the tree', () => {
    const server = start();
    server.change(resolve(ROOT, 'src/client/app/index.html'));
    expect(server.sent).toEqual([]);
  });
});
