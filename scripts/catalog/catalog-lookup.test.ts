import { describe, it, expect } from 'vitest';

import type { Catalog, CatalogRecord } from './catalog-lookup';
import { lookupByHd, lookupByRef } from './catalog-lookup';
import type { SearchEntry } from './catalog-pure';
import { parseRef } from './parse/corpus-tsv';

function stubCatalog(searchIndex?: readonly SearchEntry[]): Catalog {
  const record = (i: number) =>
    ({ i, hip: null, gaiaSourceId: null, name: null }) as CatalogRecord;
  return {
    header: {} as Catalog['header'],
    count: 4,
    record,
    *records() {
      for (let i = 0; i < 4; i++) yield record(i);
    },
    ...(searchIndex === undefined ? {} : { searchIndex }),
  };
}

const INDEX: SearchEntry[] = [
  { i: 0, hd: 49618, hda: [49619] },
  { i: 1, hd: 172167 },
];

describe('lookupByHd', () => {
  it('resolves an alias to the record that holds it', () => {
    const catalog = stubCatalog(INDEX);
    expect(lookupByHd(catalog, 49618)?.i).toBe(0);
    expect(lookupByHd(catalog, 49619)?.i).toBe(0);
    expect(lookupByHd(catalog, 172167)?.i).toBe(1);
  });

  it('answers null for an HD no record carries', () => {
    expect(lookupByHd(stubCatalog(INDEX), 99999)).toBeNull();
  });

  // A silent null here would read as "no such record" and quietly weaken every
  // corpus row addressed by hd:, so the missing index has to be loud.
  it('throws rather than missing silently when the search index is absent', () => {
    expect(() => lookupByHd(stubCatalog(), 49618)).toThrow(/withSearchIndex/);
  });

  // Same precedence as the runtime's hdMap: a record that displays the number
  // outranks another record's alias for it.
  it('prefers the record displaying an HD over another record aliasing it', () => {
    const catalog = stubCatalog([
      { i: 0, hd: 49618, hda: [49619] },
      { i: 2, hd: 49619 },
    ]);
    expect(lookupByHd(catalog, 49619)?.i).toBe(2);
  });

  it('dispatches an hd: ref through the same index', () => {
    const ref = parseRef('hd:49619', 'row', 'ref');
    expect(ref).toEqual({ kind: 'hd', value: '49619' });
    expect(lookupByRef(stubCatalog(INDEX), ref)?.i).toBe(0);
  });
});
