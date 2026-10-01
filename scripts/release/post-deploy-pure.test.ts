import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { BINARY_VERSION, HEADER_LAYOUT, HEADER_SIZE, MAGIC } from '../catalog/record/catalog-pure';
import { ROUTING_CASES, documentIdentifiers, type RoutingCase } from '../../src/routing-cases-fixture';
import {
  entryScriptOf,
  footerVersionOf,
  judgeCase,
  judgeCatalogue,
  judgeEntryScript,
  judgeFooterVersion,
  untilPassing,
} from './post-deploy-pure';
import type { RawAnswer } from './raw-get';

const identifies = documentIdentifiers(resolve(__dirname, '../..'));

function answer(status: number, body: string | Buffer = '', headers: Record<string, string> = {}): RawAnswer {
  return {
    status,
    location: headers.location ?? null,
    headers,
    body: typeof body === 'string' ? Buffer.from(body) : body,
  };
}

const caseFor = (pathname: string, search = ''): RoutingCase =>
  ROUTING_CASES.find((c) => c.pathname === pathname && c.search === search)!;

describe('judgeCase', () => {
  it('passes a redirect to the expected path, whatever origin it names', () => {
    const verdict = judgeCase(caseFor('/v/AQAA/'), answer(301, '', { location: 'https://stellata.xyz/app/v/AQAA/' }), identifies);
    expect(verdict).toBeNull();
  });

  it('fails a redirect with the wrong status', () => {
    const verdict = judgeCase(caseFor('/v/AQAA/'), answer(302, '', { location: '/app/v/AQAA/' }), identifies);
    expect(verdict).toMatch(/expected 301/);
  });

  it('fails a document served where a redirect belongs', () => {
    expect(judgeCase(caseFor('/', '?v=AQAA'), answer(200, '<title>x</title>'), identifies)).not.toBeNull();
  });

  it('passes the application document by its canvas', () => {
    expect(judgeCase(caseFor('/app'), answer(200, '<canvas id="scene"></canvas>'), identifies)).toBeNull();
  });

  it('fails the homepage served where the application belongs', () => {
    expect(judgeCase(caseFor('/app/v/AQAA/'), answer(200, '<p>home</p>'), identifies)).toMatch(/not the app/);
  });

  it('wants a 404 status for a miss, not just the 404 page', () => {
    expect(judgeCase(caseFor('/nonsense'), answer(200, ''), identifies)).toMatch(/expected 404/);
  });
});

describe('the entry script', () => {
  it('reads the module entry Vite emits, attributes in any order', () => {
    expect(entryScriptOf('<script type="module" crossorigin src="/assets/index-a1.js"></script>')).toBe('/assets/index-a1.js');
    expect(entryScriptOf('<script src="/x.js"></script><script src="/assets/b.js" type="module">')).toBe('/assets/b.js');
  });

  it('answers null for a document with no module script', () => {
    expect(entryScriptOf('<script type="application/ld+json">{}</script>')).toBeNull();
  });

  it.each(['text/javascript', 'application/javascript; charset=utf-8'])('passes %s', (type) => {
    expect(judgeEntryScript(answer(200, 'x', { 'content-type': type }))).toBeNull();
  });

  it('fails HTML served for the script, as a miss falling back to a page would be', () => {
    expect(judgeEntryScript(answer(200, '<html>', { 'content-type': 'text/html' }))).toMatch(/text\/html/);
  });
});

describe('the catalogue chunk', () => {
  function header(magic: string): Buffer {
    const bytes = Buffer.alloc(HEADER_SIZE);
    bytes.write(magic, HEADER_LAYOUT.magic, 'ascii');
    bytes.writeUInt32LE(BINARY_VERSION, HEADER_LAYOUT.version);
    return bytes;
  }

  it('passes a chunk carrying the catalogue header', () => {
    expect(judgeCatalogue(answer(200, header(MAGIC)))).toBeNull();
  });

  it('fails a chunk with a foreign magic, such as an HTML page', () => {
    expect(judgeCatalogue(answer(200, '<!doctype html><html>'.padEnd(HEADER_SIZE)))).toMatch(/magic/i);
  });

  it('fails a missing chunk', () => {
    expect(judgeCatalogue(answer(404))).toMatch(/404/);
  });
});

describe('the footer version', () => {
  const footer = (v: string) => `<footer>Stellata <span class="footer-version">v${v}</span></footer>`;

  it('reads the version the footer shows', () => {
    expect(footerVersionOf(footer('6.0.0'))).toBe('6.0.0');
  });

  it('passes the version being deployed and fails an older one', () => {
    expect(judgeFooterVersion(footer('6.0.0'), '6.0.0')).toBeNull();
    expect(judgeFooterVersion(footer('5.2.10'), '6.0.0')).toMatch(/shows v5\.2\.10/);
  });
});

describe('untilPassing', () => {
  const plan = { attempts: 3, waitMs: 5, sleep: vi.fn(async () => {}) };

  it('stops at the first clean run', async () => {
    const run = vi.fn().mockResolvedValueOnce(['stale']).mockResolvedValueOnce([null]);
    expect(await untilPassing(run, plan)).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports the last run’s failures once the attempts are spent', async () => {
    const run = vi.fn().mockResolvedValue(['still stale', null]);
    expect(await untilPassing(run, { ...plan, sleep: vi.fn(async () => {}) })).toEqual(['still stale']);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
