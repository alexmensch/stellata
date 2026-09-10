// The public pages state figures about the model, the application and the
// citation record. `scripts/site/site-metrics.ts` counts each off the thing
// itself and `vite.env.ts` substitutes it in, so what this suite holds is
// that the pages keep *asking* rather than quoting — plus the two claims a
// substitution cannot carry.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSharePath } from '../src/client/util/url-state/share-path-pure';
import { decodeBlob } from '../src/client/util/url-state/url-state';
import {
  catalogueRecordCount,
  citedReferences,
  creditedSourceCount,
} from '../scripts/site/site-metrics';

const ROOT = resolve(__dirname, '..');
const HOME = join(ROOT, 'src/site/index.html');
const NOT_FOUND = join(ROOT, 'src/site/404.html');

/** Each readout cell's label → the raw value the page carries for it. */
function readoutValues(): Map<string, string> {
  const html = readFileSync(HOME, 'utf8');
  const cells = html.matchAll(
    /<dt class="label">([^<]+)<\/dt>\s*<dd class="readout-value">([^<]+)<\/dd>/g,
  );
  return new Map([...cells].map(([, label, value]) => [label.trim(), value.trim()]));
}

describe('the pages ask for their figures rather than quoting them', () => {
  it.each([
    ['Catalogued objects', '%VITE_STAR_COUNT%'],
    ['Catalogues cited', '%VITE_SOURCE_COUNT%'],
    ['Published references', '%VITE_REFERENCE_COUNT%'],
  ])('reads %s off the repo', (label, token) => {
    expect(readoutValues().get(label)).toBe(token);
  });

  // The two the repo cannot count: both are stated in ../README.md, so they
  // are prose here on purpose rather than by omission.
  it.each(['Modelled radius', 'Clock range'])('states %s directly', (label) => {
    expect(readoutValues().get(label)).toMatch(/\d/);
  });

  it('repeats the same two counts in the citation section', () => {
    const html = readFileSync(HOME, 'utf8');
    expect(html).toContain('%VITE_SOURCE_COUNT% catalogues and datasets');
    expect(html).toContain('%VITE_REFERENCE_COUNT% published papers');
  });

  it.each([HOME, NOT_FOUND])('reads its own version off package.json', (page) => {
    expect(readFileSync(page, 'utf8')).toContain('v%VITE_APP_VERSION%');
  });
});

// A sight's picture IS its link into the model, so a blob that lost a
// character sends the reader to the app with the bar silently stripped —
// no error anywhere, and nothing else on the page to notice it.
describe('every view the homepage links to', () => {
  const links = [
    ...new Set(
      [...readFileSync(HOME, 'utf8').matchAll(/href="(\/app\/v\/[^"]+)"/g)].map(([, h]) => h),
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
    const html = readFileSync(HOME, 'utf8');
    const table = html.slice(html.indexOf('<table class="sources">'), html.indexOf('</table>'));
    const perRow = [...table.matchAll(/<td>(\d+)<\/td>/g)].map(([, n]) => Number(n));
    expect(perRow.length).toBe(7);
    expect(perRow.reduce((a, b) => a + b, 0)).toBe(creditedSourceCount(ROOT));
  });

  // Bounds, not a pin: the page reads this number rather than quoting one,
  // so drift cannot make the page wrong — a `toBe(N)` would only fail on
  // every PR that adds a citation to any README, which is the churn the
  // substitution removed. What can still make the page wrong is the pattern
  // itself: matching nothing collapses the count, and matching ordinary
  // prose ("Table 3 shows 2021") inflates it past anything the record holds.
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
