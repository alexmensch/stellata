// The rendition is derived from the authored page, so this suite holds that
// the derivation keeps the content, drops only scaffolding, and stops the
// build on an element nobody taught it rather than losing it silently.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { markdownRendition } from './markdown-rendition';

const ROOT = resolve(__dirname, '../..');
const HOME = readFileSync(join(ROOT, 'src/site/index.html'), 'utf8');

const FIGURES = {
  VITE_STAR_COUNT: '388,068',
  VITE_SOURCE_COUNT: '34',
  VITE_REFERENCE_COUNT: '108',
  VITE_APP_VERSION: '9.9.9',
};

const home = (): string => markdownRendition(HOME, FIGURES);

/** A whole page, so a rule can be checked without the homepage's bulk. */
function page(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head><title>A page</title>
    <meta name="description" content="What it is." />
    <link rel="canonical" href="https://stellata.xyz/" />${head}</head>
    <body>${body}</body></html>`;
}

describe('the rendition opens the way an agent client expects', () => {
  it('leads with the page title as its one top-level heading', () => {
    expect(home().split('\n')[0]).toBe(
      '# Stellata — 3D star catalogue and model of the measured universe',
    );
    expect(home().match(/^# /gm)).toHaveLength(1);
  });

  it('follows it with the meta description as a summary blockquote', () => {
    expect(home()).toContain(
      '> A 3D model of the universe you fly through, built only from published',
    );
  });

  it('points back at the HTML it was derived from', () => {
    expect(home()).toContain('[Read this page as HTML](https://stellata.xyz/)');
  });

  // The title takes h1, so the hero heading has to move under it or the
  // document has two roots and an agent reads two documents.
  it('shifts every body heading down a level', () => {
    expect(home()).toContain('## A 3D model of the universe with nothing invented in it.');
    expect(home()).toContain('### Three things this is.');
  });
});

describe('the page’s content survives the derivation', () => {
  it.each([
    'Around 390,000 real objects',
    'There is no false colour anywhere in Stellata',
    'The citation record is the product.',
    'Chrome and Edge 113+, Safari 26+',
  ])('keeps the prose: %s', (prose) => {
    expect(home()).toContain(prose);
  });

  it('renders the readout strip as labelled figures rather than loose text', () => {
    expect(home()).toContain('- **Catalogued objects** — 388,068');
    expect(home()).toContain('- **Clock range** — 3000 BC – 3000 AD');
  });

  it('renders the sources table as a table, header row included', () => {
    expect(home()).toMatch(/\|\s*Subsystem\s*\|\s*Sources\s*\|\s*Principal authorities\s*\|/);
    expect(home()).toMatch(/\|\s*Nearby galaxies\s*\|\s*2\s*\|/);
  });

  it('resolves every root-relative link against the canonical', () => {
    expect(home()).toContain('](https://stellata.xyz/app)');
    expect(home()).not.toMatch(/\]\(\/[a-z]/);
  });

  it('resolves the figures the page asks for rather than shipping the token', () => {
    expect(home()).not.toContain('VITE_');
    expect(home()).toContain('v9.9.9');
  });

  it('refuses to render a figure it has no value for', () => {
    expect(() => markdownRendition(HOME, {})).toThrow(/publishBuildEnv did not run/);
  });
});

describe('authoring scaffolding is dropped', () => {
  // The dashed capture boxes are instructions to the author. An agent
  // quoting them back would read the filenames of pictures that do not
  // exist as though they were the page's claims.
  it('drops the capture holders and everything they name', () => {
    expect(home()).not.toContain('placeholder');
    expect(home()).not.toContain('public/site/hero.jpg');
    expect(home()).not.toContain('2400 px');
  });

  it('drops the skip link', () => {
    expect(home()).not.toContain('Skip to content');
  });

  // Until the captures land, a sight's media anchor wraps only a holder.
  it('drops an anchor left with nothing in it', () => {
    expect(home()).not.toContain('[](');
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
