// The derivation's rules, against the homepage and small synthetic pages.
// src/site/README.md § Numbers in copy — the suites read the page.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Element, Root } from 'hast';
import { select, selectAll } from 'hast-util-select';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';

import { escapeRegExp } from '../util/escape-regexp';
import { markdownRendition } from './markdown-rendition';
import { parseHtml } from './parse-html';

const ROOT = resolve(__dirname, '../..');
const HOME = readFileSync(join(ROOT, 'src/site/index.html'), 'utf8');

const FIGURES: Record<string, string> = {
  VITE_STAR_COUNT: '388,068',
  VITE_SOURCE_COUNT: '34',
  VITE_REFERENCE_COUNT: '108',
  VITE_APP_VERSION: '9.9.9',
};

const home = markdownRendition(HOME, FIGURES);
const tree = parseHtml(HOME.replace(/%(VITE_[A-Z_]+)%/g, (_, name: string) => FIGURES[name]));
const SCAFFOLDING = new Set(selectAll('.holder, .holder *, .skip-link, .skip-link *', tree));

function textOf(node: Element | Root | null | undefined): string {
  if (node == null) return '';
  let out = '';
  visit(node, 'text', (text: { value: string }) => {
    out += text.value;
  });
  return out.replace(/\s+/g, ' ').trim();
}

/** Markdown with its inline syntax stripped, so it compares against an element's text. */
function plain(markdown: string): string {
  let text = markdown;
  for (let prev = ''; prev !== text; ) {
    prev = text;
    text = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
  }
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\(.)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ');
}

const content = (selector: string): Element[] =>
  selectAll(selector, tree).filter((el) => !SCAFFOLDING.has(el) && textOf(el) !== '');

/** A whole page, so a rule can be checked without the homepage's bulk. */
function page(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head><title>A page</title>
    <meta name="description" content="What it is." />
    <link rel="canonical" href="https://stellata.xyz/" />${head}</head>
    <body>${body}</body></html>`;
}

describe('the rendition opens the way an agent client expects', () => {
  it('leads with the page title as its one top-level heading', () => {
    expect(home.split('\n')[0]).toBe(`# ${textOf(select('title', tree))}`);
    expect(home.match(/^# /gm)).toHaveLength(1);
  });

  it('follows it with the meta description as a summary blockquote', () => {
    const description = select('meta[name="description"]', tree)?.properties?.content;
    expect(home).toContain(`> ${String(description).replace(/\s+/g, ' ').trim()}`);
  });

  it('points back at the HTML it was derived from', () => {
    const canonical = select('link[rel="canonical"]', tree)?.properties?.href;
    expect(home).toContain(`[Read this page as HTML](${String(canonical)})`);
  });

  // The title takes h1, so the hero heading has to move under it or the
  // document has two roots and an agent reads two documents.
  it.each(content('body :is(h1, h2, h3, h4)').map((h) => [h.tagName, textOf(h)]))(
    'shifts <%s> %j down a level',
    (tag, text) => {
      const hashes = '#'.repeat(Number(tag.slice(1)) + 1);
      const headings = home.split('\n').filter((line) => line.startsWith(`${hashes} `));
      expect(headings.map((line) => plain(line.slice(hashes.length + 1)).trim())).toContain(text);
    },
  );
});

describe('the page’s content survives the derivation', () => {
  it.each(content('body p').map((p) => [textOf(p)]))('keeps the paragraph %j', (text) => {
    expect(plain(home)).toContain(text);
  });

  it.each(content('.readout-cell').map((cell) => [textOf(select('dt', cell)), textOf(select('dd', cell))]))(
    'renders the readout cell %j as a labelled figure',
    (label, value) => {
      expect(home).toContain(`- **${label}** — ${value}`);
    },
  );

  it('renders every table as a table, header row included', () => {
    const tables = selectAll('table', tree);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      const header = selectAll('th', table)
        .map((th) => `\\|\\s*${escapeRegExp(textOf(th))}\\s*`)
        .join('');
      expect(home).toMatch(new RegExp(header));
      for (const row of selectAll('tbody tr', table)) {
        const first = textOf(select('td', row));
        expect(plain(home)).toMatch(new RegExp(`\\|\\s*${escapeRegExp(first)}\\s*\\|`));
      }
    }
  });

  it('resolves every link against the canonical', () => {
    expect(home).toMatch(/\]\(https:\/\//);
    expect(home).not.toMatch(/\]\((?!https?:\/\/)/);
  });

  it('resolves the figures the page asks for rather than shipping the token', () => {
    expect(home).not.toContain('VITE_');
    expect(home).toContain(FIGURES.VITE_APP_VERSION);
  });

  it('refuses to render a figure it has no value for', () => {
    expect(() => markdownRendition(HOME, {})).toThrow(/publishBuildEnv did not run/);
  });
});

describe('authoring scaffolding is dropped', () => {
  it('drops a capture holder and everything it names', () => {
    const rendered = markdownRendition(
      page('<div class="holder"><p>Save it as <code>hero.jpg</code></p></div><p>Kept.</p>'),
      FIGURES,
    );
    expect(rendered).not.toContain('hero.jpg');
    expect(rendered).toContain('Kept.');
  });

  it('drops the skip link', () => {
    const rendered = markdownRendition(page('<a class="skip-link" href="#main">Skip</a><p>Kept.</p>'), FIGURES);
    expect(rendered).not.toContain('Skip');
  });

  it('drops an anchor left with nothing in it', () => {
    const rendered = markdownRendition(
      page('<a href="/app/v/AQAA/"><div class="holder">Capture</div></a><p>Kept.</p>'),
      FIGURES,
    );
    expect(rendered).not.toContain('[](');
    expect(home).not.toContain('[](');
  });

  it('keeps a media anchor once it wraps a real capture', () => {
    const rendered = markdownRendition(
      page('<a href="/app/v/AQAA/"><img src="/site/hero.jpg" alt="The local neighbourhood" /></a>'),
      FIGURES,
    );
    expect(rendered).toContain(
      '[![The local neighbourhood](https://stellata.xyz/site/hero.jpg)](https://stellata.xyz/app/v/AQAA/)',
    );
  });
});

describe('a clip renders as the frame standing in for it', () => {
  const clip =
    '<video src="/site/hero.mp4" poster="/site/hero.jpg" aria-label="Sol behind Io" autoplay muted playsinline></video>';

  it('becomes its poster, named by its label', () => {
    expect(markdownRendition(page(clip), FIGURES)).toContain(
      '![Sol behind Io](https://stellata.xyz/site/hero.jpg)',
    );
  });

  // The anchor reads as empty while its only child is a <video>, so the
  // order of the two passes decides whether a sight keeps its link.
  it('keeps the media anchor a sight wraps it in', () => {
    expect(markdownRendition(page(`<a href="/app/v/AQAA/">${clip}</a>`), FIGURES)).toContain(
      '[![Sol behind Io](https://stellata.xyz/site/hero.jpg)](https://stellata.xyz/app/v/AQAA/)',
    );
  });

  it.each([
    ['poster', ' poster="/site/hero.jpg"', 'no poster'],
    ['aria-label', ' aria-label="Sol behind Io"', 'no aria-label'],
  ])('refuses a clip carrying no %s', (_, attribute, complaint) => {
    expect(() => markdownRendition(page(clip.replace(attribute, '')), FIGURES)).toThrow(complaint);
  });
});

describe('an element the derivation has no rule for stops the build', () => {
  it('names the tag rather than dropping its content', () => {
    expect(() => markdownRendition(page('<details><summary>Hi</summary></details>'), FIGURES)).toThrow(
      /no rule for <details>, <summary>/,
    );
  });

  it('says what to do about it', () => {
    expect(() => markdownRendition(page('<aside>Later</aside>'), FIGURES)).toThrow(/VOCABULARY/);
  });

  // The preamble is derived too, so a page that lost its canonical or its
  // title would otherwise emit links relative to nothing.
  it.each([
    ['<link rel="canonical"', 'states no canonical URL'],
    ['<title>', 'has no <title>'],
  ])('refuses a page missing %s', (missing, complaint) => {
    const broken = page('<p>Hello</p>').replace(
      missing === '<title>' ? /<title>[^<]*<\/title>/ : /<link rel="canonical"[^>]*>/,
      '',
    );
    expect(() => markdownRendition(broken, FIGURES)).toThrow(complaint);
  });
});
