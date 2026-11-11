import { describe, expect, it } from 'vitest';

import type { SearchEntrySource } from '../../../src/catalog-format/record/catalog-pure';
import { buildSearchIndex, searchIndexSummary } from './search-index-pure';

function source(over: Partial<SearchEntrySource>): SearchEntrySource {
  return {
    proper: null, bayer: null, bayerSup: null, bayerComponent: null, gould: null, gouldHalf: null,
    aliases: [], flam: null, hip: null, hd: null, hr: null, hdAlt: [], hrAlt: [], gl: null,
    gcvsName: null, conIndex: 3, desigCon: { via: 'none' }, spectDisplay: null, ...over,
  };
}

describe('buildSearchIndex', () => {
  it('keeps the searchable records in order and counts the ones naming another constellation', () => {
    const { entries, counts } = buildSearchIndex([
      source({ hip: 1 }),
      source({}),
      source({ flam: 67, desigCon: { index: 4 } }),
      source({}),
    ], new Map([[3, { comp: 'B', primaryIdx: 0 }]]));
    expect(entries.map((e) => e.i)).toEqual([0, 2, 3]);
    expect(counts).toEqual({ searchEntries: 3, designationConMismatch: 1 });
    expect(searchIndexSummary(counts, 3 * 1024 * 1024)).toBe('3 searchable entries, 3.00 MB');
  });
});
