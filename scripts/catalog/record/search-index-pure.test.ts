import { describe, expect, it } from 'vitest';

import type { SearchEntrySource } from '../../../src/catalog-format/record/catalog-pure';
import { enterPhase, type Finalised } from './record-phase';
import { buildSearchIndex, searchIndexSummary } from './search-index-pure';

function source(over: Partial<SearchEntrySource>): SearchEntrySource {
  return {
    bayer: null, bayerSup: null, bayerComponent: null, gould: null, gouldHalf: null,
    aliases: [], flam: null, hip: null, hd: null, hr: null, hdAlt: [], hrAlt: [], gl: null,
    gcvsName: null, conIndex: 3, desigCon: { via: 'none' }, spectDisplay: null, ...over,
  };
}

function finalised(records: SearchEntrySource[], displayNames: (string | null)[]): Finalised<SearchEntrySource> {
  return { records: enterPhase('sorted', records), sids: records.map((_, i) => i + 1), displayNames };
}

describe('buildSearchIndex', () => {
  it('keeps the searchable records in order, a display name among them, and counts the ones naming another constellation', () => {
    const { entries, counts } = buildSearchIndex(finalised([
      source({ hip: 1 }),
      source({}),
      source({ flam: 67, desigCon: { index: 4 } }),
      source({}),
      source({}),
    ], [null, null, null, null, 'Vega']), new Map([[3, { comp: 'B', primaryIdx: 0 }]]));
    expect(entries.map((e) => e.i)).toEqual([0, 2, 3, 4]);
    expect(entries[3].p).toBe('Vega');
    expect(counts).toEqual({ searchEntries: 4, designationConMismatch: 1 });
    expect(searchIndexSummary(counts, 3 * 1024 * 1024)).toBe('4 searchable entries, 3.00 MB');
  });
});
