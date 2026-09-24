// src/site/README.md § Numbers in copy.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Element } from 'hast';
import { select, selectAll } from 'hast-util-select';
import { visit } from 'unist-util-visit';
import { describe, expect, it } from 'vitest';

import { parseSharePath } from '../src/client/util/url-state/share-path-pure';
import { decodeBlob } from '../src/client/util/url-state/url-state';
import { parseHtml } from '../scripts/site/parse-html';
import {
  catalogueRecordCount,
  citedReferences,
  creditedSourceCount,
} from '../scripts/site/site-metrics';

const ROOT = resolve(__dirname, '..');
const HOME_SOURCE = readFileSync(join(ROOT, 'src/site/index.html'), 'utf8');
const HOME = parseHtml(HOME_SOURCE);
const NOT_FOUND = parseHtml(readFileSync(join(ROOT, 'src/site/404.html'), 'utf8'));
const TOKEN = /^%VITE_[A-Z_]+%$/;

function textOf(node: Element | null | undefined): string {
  if (node == null) return '';
  let out = '';
  visit(node, 'text', (text: { value: string }) => {
    out += text.value;
  });
  return out.replace(/\s+/g, ' ').trim();
}

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
    ['catalogue size', catalogueRecordCount(ROOT).toLocaleString('en-US')],
    ['credited source count', String(creditedSourceCount(ROOT))],
    ['reference count', String(citedReferences(ROOT).size)],
  ])('never states the %s as a literal', (_, figure) => {
    const body = textOf(select('body', HOME));
    expect(body).not.toMatch(new RegExp(`(^|[^\\d,.])${figure.replace(/[.,]/g, '\\$&')}($|[^\\d,])`));
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

  // Bounds, not a pin: the page reads this number, so drift cannot make it
  // wrong. What can is the pattern: matching nothing collapses the count, and
  // matching ordinary prose ("Table 3 shows 2021") inflates it.
  it('finds a reference record neither collapsed nor inflated', () => {
    const derived = citedReferences(ROOT).size;
    expect(derived).toBeGreaterThan(80);
    expect(derived).toBeLessThan(400);
  });

  it('reads the catalogue size with no built artifact to read', () => {
    const snapshot = JSON.parse(
      readFileSync(join(ROOT, 'scripts/catalog/build-catalog-expected.json'), 'utf8'),
    );
    expect(catalogueRecordCount('/nonexistent-root')).toBe(snapshot.recordCount);
    expect(catalogueRecordCount(ROOT)).toBe(snapshot.recordCount);
  });
});
