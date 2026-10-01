// /src/site/README.md#numbers-in-copy.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Element, Root } from 'hast';
import { select, selectAll } from 'hast-util-select';
import { describe, expect, it } from 'vitest';

import { parseSharePath } from '../src/client/util/url-state/share-path-pure';
import { decodeBlob } from '../src/client/util/url-state/url-state';
import { FIGURE_NAMES, FIGURE_TOKEN } from '../scripts/site/figures-pure';
import { parseHtml, textOf } from '../scripts/site/parse-html';
import { escapeRegExp } from '../scripts/util/escape-regexp';
import {
  citationEntries,
  citedReferenceCount,
  creditedSourceCount,
} from '../scripts/site/site-metrics';
import { NOT_FOUND_SOURCE, SITE_PAGES } from '../src/site/pages';
import { buildFigures } from '../vite.env';

const ROOT = resolve(__dirname, '..');
const HOME_SOURCE = readFileSync(join(ROOT, 'src/site/index.html'), 'utf8');
const HOME = parseHtml(HOME_SOURCE);
const NOT_FOUND = parseHtml(readFileSync(join(ROOT, 'src/site/404.html'), 'utf8'));
const TOKEN = new RegExp(`^%(?:${FIGURE_NAMES.join('|')})%$`);
const FIGURES = buildFigures(ROOT);
const DOCUMENTS = [
  ...[...SITE_PAGES.map((page) => page.source), NOT_FOUND_SOURCE].map((source) => `src/site/${source}`),
  'src/client/app/index.html',
];

describe('the pages ask for their figures rather than quoting them', () => {
  const cells = selectAll('.readout-value', HOME);

  it('carries a readout', () => {
    expect(cells.filter((cell) => TOKEN.test(textOf(cell))).length).toBeGreaterThan(0);
  });

  it.each(cells.map((cell) => [textOf(cell), cell]))('%s is a substitution or marked literal', (text, cell) => {
    if ((cell as Element).properties?.dataLiteral !== undefined) expect(text).toMatch(/\d/);
    else expect(text).toMatch(TOKEN);
  });

  it.each([
    ['catalogue size', FIGURES.VITE_STAR_COUNT],
    ['credited source count', FIGURES.VITE_SOURCE_COUNT],
    ['reference count', FIGURES.VITE_REFERENCE_COUNT],
  ])('never states the %s as a literal', (_, figure) => {
    const body = textOf(select('body', HOME));
    expect(body).not.toMatch(new RegExp(`(^|[^\\d,.])${escapeRegExp(figure)}($|[^\\d,])`));
  });

  it.each(DOCUMENTS)('%s asks only for figures the build publishes', (document) => {
    const names = [...readFileSync(join(ROOT, document), 'utf8').matchAll(FIGURE_TOKEN)].map((m) => m[1]);
    expect(names.filter((name) => !(FIGURE_NAMES as readonly string[]).includes(name))).toEqual([]);
  });

  it.each([
    ['homepage', HOME],
    ['404 page', NOT_FOUND],
  ])('the %s reads its own version off package.json', (_, page) => {
    expect(textOf(select('body', page))).toContain('%VITE_APP_VERSION%');
  });
});

// A sight's picture IS its link into the model, so a blob that lost a
// character lands on the app with the bar silently stripped.
describe('every view the homepage links to', () => {
  const links = [
    ...new Set(
      selectAll('a[href^="/app/v/"]', HOME).map((a) => String(a.properties?.href)),
    ),
  ];

  it('links to at least one saved view', () => {
    expect(links.length).toBeGreaterThan(0);
  });

  it.each(links)('%s decodes', (href) => {
    const blob = parseSharePath(href);
    expect(blob).not.toBeNull();
    expect(() => decodeBlob(blob!)).not.toThrow();
  });
});

// /src/site/README.md#one-script.
describe('every sight clip waits to be seen', () => {
  const clips = selectAll('video[data-replay]', HOME);

  it('has at least one', () => {
    expect(clips.length).toBeGreaterThan(0);
  });

  it.each(clips.map((video) => [String(video.properties?.src), video]))('%s', (_, video) => {
    const { autoPlay, preload } = (video as Element).properties ?? {};
    expect(autoPlay).toBeUndefined();
    expect(preload).toBe('none');
  });
});

// /src/site/README.md#sights--the-media-and-the-link-it-carries.
describe('every sight links where its take ends', () => {
  const commentsIn = (node: Element | Root): string[] =>
    node.children.flatMap((child) =>
      child.type === 'comment' ? [child.value] : child.type === 'element' ? commentsIn(child) : [],
    );
  const sights = selectAll('.sight', HOME);

  it('has at least one sight', () => {
    expect(sights.length).toBeGreaterThan(0);
  });

  it.each(sights.map((sight) => [textOf(select('h3', sight)), sight]))('%s', (_, sight) => {
    const hrefs = selectAll('a[href]', sight as Element).map((a) => String(a.properties?.href));
    expect(hrefs).toHaveLength(2);
    expect(new Set(hrefs).size).toBe(1);
    const take = commentsIn(sight as Element).find((comment) => comment.includes('debug.capture('));
    if (take === undefined) return;
    const pose = /\bend:\s*'([^']+)'/.exec(take) ?? /\bstart:\s*'([^']+)'/.exec(take);
    expect(pose).not.toBeNull();
    expect(parseSharePath(hrefs[0])).toBe(pose![1]);
  });
});

describe('the derivations behind those figures', () => {
  it('counts the sources the application credits', () => {
    expect(creditedSourceCount(ROOT)).toBe(34);
  });

  // The subsystem table splits that same total, so a source added to the app
  // has to land in a row rather than only moving the headline.
  it('splits the credited total across the subsystem table without losing any', () => {
    const rows = selectAll('table.sources tbody tr', HOME);
    const perRow = rows.map((row) => Number(textOf(selectAll('td', row)[1])));
    expect(rows.length).toBeGreaterThan(0);
    expect(perRow.every(Number.isInteger)).toBe(true);
    expect(perRow.reduce((a, b) => a + b, 0)).toBe(creditedSourceCount(ROOT));
  });

  it('counts the works the citation index records', () => {
    expect(citedReferenceCount(ROOT)).toBe(200);
  });
});

// <base target="_blank"> opens every link in a new tab; a link within the site
// opts back into the same one.
describe.each([
  ['homepage', HOME],
  ['404 page', NOT_FOUND],
])('links on the %s open in a new tab unless they stay on the site', (_, page) => {
  it('defaults every link to a new tab', () => {
    expect(select('head > base', page)?.properties?.target).toBe('_blank');
  });

  it.each(selectAll('a[href]', page).map((a) => [String(a.properties?.href), a]))('%s', (href, a) => {
    const sameTab = (a as Element).properties?.target === '_self';
    expect(sameTab).toBe(/^[/#]/.test(href as string));
  });
});

// "Zucker 2020 & 2021" names two works.
const AUTHOR_YEARS = /(\p{Lu}[\p{L}'’-]+(?: \p{Lu}[\p{L}'’-]+)*) (\d{4}[a-z]?(?: & \d{4}[a-z]?)*)\b/gu;

describe('every author-year the sources table names', () => {
  const labels = new Set(citationEntries(ROOT).map((entry) => entry.label));
  const named = selectAll('table.sources tbody tr', HOME).flatMap((row) =>
    [...textOf(selectAll('td', row)[2]).matchAll(AUTHOR_YEARS)].flatMap(([, author, years]) =>
      years.split(' & ').map((year) => `${author} ${year}`),
    ),
  );

  it('names at least one', () => {
    expect(named.length).toBeGreaterThan(0);
  });

  it.each(named)('%s is a citation-index label', (label) => {
    expect(labels.has(label)).toBe(true);
  });
});
