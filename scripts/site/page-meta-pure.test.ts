import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { select } from 'hast-util-select';
import { describe, expect, it } from 'vitest';

import { pageAt } from '../../src/site/pages';
import { builtLlmsTxt } from './llms-txt';
import { JSON_LD_BLOCK } from './json-ld-citations-pure';
import { fillPageMeta, pageMeta, substitutePageMeta } from './page-meta-pure';
import { parseHtml } from './parse-html';

const SITE_DIR = resolve(__dirname, '../../src/site');
const HOME = readFileSync(resolve(SITE_DIR, pageAt('/')!.source), 'utf8');

const head = (inner: string) => `<!doctype html><html><head>${inner}</head><body></body></html>`;
const TITLE = '<title>A  page</title>';
const DESCRIPTION = '<meta name="description" content="What it\n   is." />';

describe('pageMeta', () => {
  it('reads the title and description, whitespace collapsed', () => {
    expect(pageMeta(head(TITLE + DESCRIPTION), 'p')).toEqual({ title: 'A page', description: 'What it is.' });
  });

  it.each([
    ['<title>', DESCRIPTION, /no <title>/],
    ['meta description', TITLE, /no meta description/],
  ])('refuses a page with no %s', (_, inner, complaint) => {
    expect(() => pageMeta(head(inner), 'p')).toThrow(complaint);
  });

  it('refuses a title that is itself a token', () => {
    expect(() => pageMeta(head('<title>%PAGE_TITLE%</title>' + DESCRIPTION), 'p')).toThrow(/itself a %PAGE_…% token/);
  });
});

describe('substitutePageMeta', () => {
  const meta = { title: 'T & "U"', description: 'D' };

  it('fills both tokens, through the encoder given', () => {
    expect(substitutePageMeta('%PAGE_TITLE% / %PAGE_DESCRIPTION%', meta, 'p', (v) => `[${v}]`)).toBe('[T & "U"] / [D]');
  });

  it('refuses a token naming neither', () => {
    expect(() => substitutePageMeta('%PAGE_AUTHOR%', meta, 'p')).toThrow(/%PAGE_AUTHOR% names neither/);
  });
});

describe('fillPageMeta', () => {
  const page = head(
    '<title>Stars &amp; "dust" &lt;3</title><meta name="description" content="D" />' +
      '<meta property="og:title" content="%PAGE_TITLE%" />' +
      '<script type="application/ld+json">{"name":"%PAGE_TITLE%"}</script>',
  );
  const filled = fillPageMeta(page, 'p');

  it('fills an attribute as an attribute value', () => {
    expect(filled).toContain('<meta property="og:title" content="Stars &amp; &quot;dust&quot; &lt;3" />');
  });

  it('fills JSON-LD as JSON string content, so the block still parses', () => {
    const [block] = [...filled.matchAll(JSON_LD_BLOCK)];
    expect(JSON.parse(block[2])).toEqual({ name: 'Stars & "dust" <3' });
    expect(block[2]).not.toContain('<3');
  });
});

describe('the homepage states its title and description once', () => {
  const RESTATEMENTS: [string, 'title' | 'description'][] = [
    ['meta[property="og:title"]', 'title'],
    ['meta[name="twitter:title"]', 'title'],
    ['meta[property="og:description"]', 'description'],
    ['meta[name="twitter:description"]', 'description'],
  ];
  const meta = pageMeta(HOME, 'home');
  const source = parseHtml(HOME);
  const filled = fillPageMeta(HOME, 'home');
  const built = parseHtml(filled);
  const webPage = (html: string) =>
    [...html.matchAll(JSON_LD_BLOCK)]
      .flatMap((block) => (JSON.parse(block[2]) as { '@graph': Record<string, string>[] })['@graph'])
      .find((node) => node['@type'] === 'WebPage')!;

  it.each(RESTATEMENTS)('%s asks for the %s rather than restating it', (selector, field) => {
    expect(select(selector, source)?.properties?.content).toBe(`%PAGE_${field.toUpperCase()}%`);
    expect(select(selector, built)?.properties?.content).toBe(meta[field]);
  });

  it('names and describes the WebPage node from the same two', () => {
    expect(webPage(HOME)).toMatchObject({ name: '%PAGE_TITLE%', description: '%PAGE_DESCRIPTION%' });
    expect(webPage(filled)).toMatchObject({ name: meta.title, description: meta.description });
  });
});

describe('the built llms.txt', () => {
  const built = builtLlmsTxt(SITE_DIR);

  it("summarises the site in the homepage's own description", () => {
    const summary = built.split('\n').find((line) => line.startsWith('> '));
    expect(summary).toBe(`> ${pageMeta(HOME, 'home').description}`);
  });

  it('opens with one top-level heading and carries no token', () => {
    expect(built.match(/^# /gm)).toHaveLength(1);
    expect(built).not.toMatch(/%[A-Z_]+%/);
  });

  it('is links only below the summary', () => {
    const items = built.split('\n').filter((line) => line.startsWith('- '));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)]+\)/);
  });
});
