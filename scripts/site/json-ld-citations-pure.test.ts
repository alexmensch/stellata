import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { IndexEntry } from '../util/citation-index-pure';
import { JSON_LD_BLOCK, citedWork, withIndexCitations } from './json-ld-citations-pure';
import { citationEntries } from './site-metrics';

const ROOT = resolve(__dirname, '../..');
const HOME = readFileSync(join(ROOT, 'src/site/index.html'), 'utf8');

function entry(fields: Partial<IndexEntry>): IndexEntry {
  return { key: 'k', line: 1, label: 'Author 2000', title: 'A title', reference: '', copy: '', notes: [], rows: [], ...fields };
}

type Node = { citation?: Record<string, unknown>[]; '@graph'?: Node[] };

function citations(html: string): Record<string, unknown>[] {
  const [block] = [...html.matchAll(JSON_LD_BLOCK)];
  if (block === undefined) throw new Error('no ld+json block');
  const body = block[2];
  const graph = JSON.parse(body) as Node;
  return (graph['@graph'] ?? [graph]).flatMap((node) => node.citation ?? []);
}

describe('citedWork', () => {
  it('takes the DOI as identifier and every other link as sameAs', () => {
    const work = citedWork(
      entry({
        label: 'French 1988',
        title: 'Uranian ring orbits',
        reference:
          'Icarus 73, 349-378 (1988) · [doi:10.1016/0019-1035(88)90104-2](https://doi.org/10.1016/0019-1035(88)90104-2) · [1988Icar...73..349F](https://ui.adsabs.harvard.edu/abs/1988Icar...73..349F)',
      }),
    );
    expect(work).toEqual({
      '@type': 'CreativeWork',
      name: 'Uranian ring orbits',
      datePublished: '1988',
      identifier: 'https://doi.org/10.1016/0019-1035(88)90104-2',
      sameAs: ['https://ui.adsabs.harvard.edu/abs/1988Icar...73..349F'],
    });
  });

  it('dates a lettered label by its year, and omits identifiers it does not have', () => {
    expect(citedWork(entry({ label: 'Tomasko 2008b', reference: 'Cambridge (1930)' }))).toEqual({
      '@type': 'CreativeWork',
      name: 'A title',
      datePublished: '2008',
    });
  });

  it('refuses a label with no year', () => {
    expect(() => citedWork(entry({ label: 'Meeus' }))).toThrow(/no year/);
  });
});

describe('withIndexCitations', () => {
  const page = (citation: unknown[]) =>
    `<head><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'Person' }, { citation }] })}</script></head>`;

  it('appends the index after the page’s own entries', () => {
    const out = citations(withIndexCitations(page([{ name: 'Hand' }]), [entry({ title: 'Indexed' })]));
    expect(out.map((work) => work.name)).toEqual(['Hand', 'Indexed']);
  });

  it('leaves a page without a citation array untouched', () => {
    const html = '<script type="application/ld+json">{"@graph":[{"@type":"Person"}]}</script>';
    expect(withIndexCitations(html, [entry({})])).toBe(html);
  });

  it('reads a single-node block with no @graph', () => {
    const lone = '<script type="application/ld+json">{"@type":"WebPage"}</script>';
    expect(withIndexCitations(lone, [entry({})])).toBe(lone);
    const citing = `<script type="application/ld+json">${JSON.stringify({ '@type': 'WebPage', citation: [] })}</script>`;
    expect(citations(withIndexCitations(citing, [entry({ title: 'Indexed' })]))).toEqual([
      expect.objectContaining({ name: 'Indexed' }),
    ]);
  });

  it('finds a block whose script tag carries other attributes', () => {
    const html = `<script id="ld" type="application/ld+json" nonce="n">${JSON.stringify({ '@graph': [{ citation: [] }] })}</script>`;
    expect(citations(withIndexCitations(html, [entry({ title: 'Indexed' })])).map((work) => work.name)).toEqual(['Indexed']);
  });

  it('finds a block whatever the case of its tags and the quoting of its type', () => {
    const graph = JSON.stringify({ '@graph': [{ citation: [] }] });
    for (const html of [
      `<SCRIPT TYPE="application/ld+json">${graph}</SCRIPT >`,
      `<script type='application/ld+json'>${graph}</script>`,
      `<script type=application/ld+json>${graph}</script>`,
    ]) {
      expect(citations(withIndexCitations(html, [entry({ title: 'Indexed' })])).map((work) => work.name)).toEqual(['Indexed']);
    }
  });

  it('keeps a title from closing the script element', () => {
    const out = withIndexCitations(page([]), [entry({ title: '</script><b>' })]);
    expect(out.match(/<\/script>/g)).toHaveLength(1);
    expect(citations(out)[0].name).toBe('</script><b>');
  });

  it('refuses a second citation array', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ citation: [] }, { citation: [] }] })}</script>`;
    expect(() => withIndexCitations(html, [])).toThrow(/2 citation arrays/);
  });
});

describe('the homepage', () => {
  const entries = citationEntries(ROOT);
  const hand = citations(HOME);
  const built = citations(withIndexCitations(HOME, entries));

  it('hand-writes only the credited sources that are not cited works', () => {
    expect(hand).toHaveLength(6);
    const titles = new Set(entries.map((e) => e.title));
    const identifiers = new Set(entries.map((e) => citedWork(e).identifier).filter((id) => id !== undefined));
    for (const work of hand) {
      expect(titles.has(work.name as string)).toBe(false);
      if (work.identifier !== undefined) expect(identifiers.has(work.identifier as string)).toBe(false);
    }
  });

  it('cites every citation-index work once, after them', () => {
    expect(built).toHaveLength(hand.length + entries.length);
    expect(built.slice(hand.length).map((work) => work.name)).toEqual(entries.map((e) => e.title));
  });

  it('gives every DOI-bearing entry its DOI', () => {
    const withDoi = entries.filter((e) => e.reference.includes('](https://doi.org/'));
    expect(built.filter((work) => typeof work.identifier === 'string' && work.identifier.startsWith('https://doi.org/'))).toHaveLength(
      withDoi.length,
    );
  });
});
