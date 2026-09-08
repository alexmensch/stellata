// The homepage's numeric claims, re-derived from what they describe. A
// marketing page states the citation record's size, and prose cannot read
// anything — so the sources are counted here instead.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { walkFiles } from './walk-files';

const ROOT = resolve(__dirname, '..');
const HOME = join(ROOT, 'src/site/home/index.html');
const APP = join(ROOT, 'src/client/index.html');

/** The modelling record the reference claim describes: the two root docs
 *  plus every markdown file under these roots — the science docs and the
 *  folder READMEs, which carry a subsystem's citations next to its code.
 *  `src/site/home/README.md` § Where every number on the page comes from. */
const RECORD_DOCS = ['SCIENCE.md', 'README.md'];
const RECORD_ROOTS = ['docs', 'src', 'scripts', 'data'];

/**
 * How far the derived reference count may run ahead of the figure the page
 * quotes before the claim reads as stale rather than conservative. The page
 * quotes a floor ("100+"), so it can only ever be true — this is what makes
 * it also stay *informative*: cross the bucket and CI asks for the next one.
 */
const CLAIM_BUCKET = 30;

/** Every credited source in the application's Credits tab is one `<div>`
 *  child of a `.credit-entry` that is not the entry's own label. */
function appCreditRows(): number {
  const app = readFileSync(APP, 'utf8');
  const block = app.slice(app.indexOf('class="modal-credits"'));
  const credits = block.slice(0, block.indexOf('</div>\n          </div>'));
  return [...credits.matchAll(/^\s*<div>(?!<div)/gm)].length;
}

function recordFiles(): string[] {
  const walked = RECORD_ROOTS.flatMap((root) => [
    ...walkFiles(join(ROOT, root), {
      include: (path) => path.endsWith('.md'),
      skipDir: (name) => name === 'node_modules' || name === 'public',
    }),
  ]);
  return [...RECORD_DOCS.map((f) => join(ROOT, f)), ...walked];
}

/**
 * Distinct author-year citations, counting only the multi-author forms
 * (`Høg et al. 2000`, `Bland-Hawthorn & Gerhard 2016`). Single-author
 * citations are real references this cannot see, so the count is a floor on
 * the record and never a measure of it — which is the direction the page's
 * claim needs.
 */
function citedReferences(): Set<string> {
  const pattern =
    /\b([A-Z][A-Za-zÀ-ÿ'-]+)(?:,? (?:et al\.|(?:&(?:amp;)?|and) [A-Z][A-Za-zÀ-ÿ'-]+)) \(?((?:1[89]|20)\d{2})[ab]?\)?/g;
  const refs = new Set<string>();
  for (const file of recordFiles()) {
    for (const [, author, year] of readFileSync(file, 'utf8').matchAll(pattern)) {
      refs.add(`${author} ${year}`);
    }
  }
  return refs;
}

/** The homepage's readout strip, as a label → value map. */
function readoutValues(): Map<string, string> {
  const html = readFileSync(HOME, 'utf8');
  const cells = html.matchAll(
    /<span class="label">([^<]+)<\/span>\s*<span class="readout-value">([^<]+)<\/span>/g,
  );
  return new Map([...cells].map(([, label, value]) => [label.trim(), value.trim()]));
}

describe('the homepage counts its own sources', () => {
  it('quotes the number of catalogues the application credits', () => {
    const credited = appCreditRows();
    expect(credited).toBe(34);
    expect(readoutValues().get('Catalogues cited')).toBe(String(credited));
  });

  // The § 02 table splits the same total by subsystem, so a source added to
  // the app has to land in a row rather than only bumping the headline.
  it('splits that total across the subsystem table without losing any', () => {
    const html = readFileSync(HOME, 'utf8');
    const table = html.slice(
      html.indexOf('<table class="sources">'),
      html.indexOf('</table>'),
    );
    const perRow = [...table.matchAll(/<td>(\d+)<\/td>/g)].map(([, n]) => Number(n));
    expect(perRow.length).toBe(7);
    expect(perRow.reduce((a, b) => a + b, 0)).toBe(appCreditRows());
  });

  it('quotes a reference floor the record still clears', () => {
    const quoted = readoutValues().get('Published references');
    expect(quoted).toMatch(/^\d+\+$/);
    const floor = Number(quoted!.replace('+', ''));
    const derived = citedReferences().size;

    // True: the record carries at least what the page claims.
    expect(derived).toBeGreaterThanOrEqual(floor);
    // Still informative: raise the page's figure to the next bucket when
    // this fails, then move it here — the page and its README are the sweep.
    expect(derived).toBeLessThan(floor + CLAIM_BUCKET);
  });
});
