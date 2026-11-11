// The search index's entries and the search stage's count block. See README.md.

import {
  buildSearchEntry, type SearchEntry, type SearchEntrySource,
} from '../../../src/catalog-format/record/catalog-pure';
import type { ComponentDesignation } from '../companions/record-index/record-index';

/** The search stage's count block. */
export type SearchCounts = {
  /** Entries in search-index.json (stars with at least one searchable
   *  identifier). */
  searchEntries: number;
  /** Search entries carrying `dc` — a designation constellation that
   *  differs from the record's positional one, so its Bayer / Flamsteed /
   *  GCVS aliases are built against the designation's constellation instead
   *  (ρ Aql / 67 Aql). */
  designationConMismatch: number;
};

/** One entry per record carrying an identifier a user might type, in record order. */
export function buildSearchIndex(
  records: readonly SearchEntrySource[],
  components: ReadonlyMap<number, ComponentDesignation>,
): { entries: SearchEntry[]; counts: SearchCounts } {
  const entries: SearchEntry[] = [];
  let designationConMismatch = 0;
  for (let i = 0; i < records.length; i++) {
    const entry = buildSearchEntry(records[i], i, components.get(i));
    if (entry === null) continue;
    entries.push(entry);
    if (entry.dc !== undefined) designationConMismatch++;
  }
  return { entries, counts: { searchEntries: entries.length, designationConMismatch } };
}

export function searchIndexSummary(counts: SearchCounts, bytes: number): string {
  return `${counts.searchEntries} searchable entries, ${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
