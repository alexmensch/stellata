// README.md#the-three-assets-keys-the-rules-depend-on.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { unstable_startWorker } from 'wrangler';

import { APP_PATH, SHARE_PARAM, buildSharePath } from './client/util/url-state/share-path-pure';
import { MARKDOWN_TYPE } from './negotiation-pure';
import { NAVIGATE, locationPath as pathOf, rawGet } from '../scripts/release/raw-get';

const BUILT: Record<string, string> = {
  'index.html': 'the homepage',
  'index.md': '# the homepage, as markdown',
  'app/index.html': 'the application document',
  'app/real-asset.txt': 'a real asset under /app',
  '404.html': 'the 404 page',
};

const BLOB = 'AQAA';

const dist = mkdtempSync(join(tmpdir(), 'stellata-assets-'));
for (const [path, body] of Object.entries(BUILT)) {
  mkdirSync(dirname(join(dist, path)), { recursive: true });
  writeFileSync(join(dist, path), body);
}

async function start() {
  try {
    const started = await unstable_startWorker({
      config: resolve(__dirname, '../wrangler.toml'),
      assets: dist,
      dev: { server: { port: 0 }, inspector: false, persist: false, watch: false, logLevel: 'none' },
    });
    await started.ready;
    return started;
  } catch {
    return null;
  }
}

const worker = await start();

afterAll(async () => {
  await worker?.dispose();
  rmSync(dist, { recursive: true, force: true });
});

async function navigate(path: string, headers: Readonly<Record<string, string>> = NAVIGATE) {
  const answer = await rawGet(new URL(path, await worker!.url), headers);
  return { ...answer, body: answer.body.toString('utf8') };
}

// Skips only where wrangler's local runtime cannot start on this machine.
describe.skipIf(worker === null)('behind the real assets layer', () => {
  it('serves the application document for a share link a browser opens', async () => {
    const { status, body } = await navigate(buildSharePath(BLOB));
    expect(status).toBe(200);
    expect(body).toBe(BUILT['app/index.html']);
  });

  it('serves the application at its bare path, not a redirect to a slash', async () => {
    const { status, body } = await navigate(APP_PATH);
    expect(status).toBe(200);
    expect(body).toBe(BUILT['app/index.html']);
  });

  it('redirects the slashed application path to the bare one', async () => {
    const { status, location } = await navigate(`${APP_PATH}/`);
    expect(status).toBe(307);
    expect(pathOf(location)).toBe(APP_PATH);
  });

  it('lets a real asset under /app win over the fallback', async () => {
    const { body } = await navigate(`${APP_PATH}/real-asset.txt`);
    expect(body).toBe(BUILT['app/real-asset.txt']);
  });

  it('301s a root-relative share link a browser opens', async () => {
    const { status, location } = await navigate(`/v/${BLOB}/`);
    expect(status).toBe(301);
    expect(pathOf(location)).toBe(buildSharePath(BLOB));
  });

  it('301s a legacy query link off the homepage', async () => {
    const { status, location } = await navigate(`/?${SHARE_PARAM}=${BLOB}`);
    expect(status).toBe(301);
    expect(pathOf(location)).toBe(buildSharePath(BLOB));
  });

  it('serves the markdown rendition at the root to a client that names it', async () => {
    const { status, headers, body } = await navigate('/', { accept: 'text/markdown' });
    expect(status).toBe(200);
    expect(headers['content-type']).toMatch(/^text\/markdown/);
    expect(headers.vary).toMatch(/\bAccept\b/);
    expect(body).toBe(BUILT['index.md']);
  });

  it('types the rendition as markdown at its own path', async () => {
    const { status, headers, body } = await navigate('/index.md', { accept: '*/*' });
    expect(status).toBe(200);
    expect(headers['content-type']).toBe(MARKDOWN_TYPE);
    expect(body).toBe(BUILT['index.md']);
  });

  it.each([
    ['/', { accept: 'text/markdown' }],
    ['/index.md', { accept: '*/*' }],
  ])('names the homepage as canonical on the rendition at %s', async (path, headers) => {
    const link = /^<([^>]+)>; rel="canonical"$/.exec(String((await navigate(path, headers)).headers.link));
    // The local proxy rewrites the origin to its own; worker.test.ts pins it.
    expect(pathOf(link?.[1] ?? null)).toBe('/');
  });

  it('advertises the rendition on the HTML homepage', async () => {
    const { headers, body } = await navigate('/');
    expect(body).toBe(BUILT['index.html']);
    expect(headers.link).toMatch(/rel="alternate"/);
    expect(headers.vary).toMatch(/\bAccept\b/);
  });

  it('answers the 404 page’s own path with a 404 too', async () => {
    const { status, body } = await navigate('/404');
    expect(status).toBe(404);
    expect(body).toBe(BUILT['404.html']);
  });

  it('answers a document’s file path by redirecting to where it is served', async () => {
    const { status, location } = await navigate('/index.html');
    expect(status).toBe(307);
    expect(pathOf(location)).toBe('/');
  });

  it('answers a junk path with the 404 page at a 404', async () => {
    const { status, body } = await navigate('/nonsense');
    expect(status).toBe(404);
    expect(body).toBe(BUILT['404.html']);
  });
});
