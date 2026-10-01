import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { pageAt } from '../../src/site/pages';
import { builtLlmsTxt } from './llms-txt';
import { pageMeta, substitutePageMeta } from './page-meta-pure';

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
