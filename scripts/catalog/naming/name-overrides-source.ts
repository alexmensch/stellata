// The curated display-name escape hatch, keyed on SID, declared.

import { defineSource, type Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';

const FROM: Declared = {
  file: 'data/naming/name_overrides.tsv',
  hint: 'It is hand-curated: restore the sid and display_name columns.',
};

export function parseNameOverrides(text: string, from: Declared): Map<number, string> {
  const out = new Map<number, string>();
  for (const row of readTable({ ...from, columns: ['sid', 'display_name'] as const }, text)) {
    const sid = row.int('sid');
    const name = row.text('display_name');
    if (sid === null || sid <= 0 || name === null) {
      return row.fail('unusable row: needs a positive sid and a display_name');
    }
    out.set(sid, name);
  }
  return out;
}

/** The curated escape hatch, keyed on SID because that identity survives
 *  re-indexing and a no-Gaia record has no source_id (/docs/star-naming.md#7-curation-seam).
 * Expected to stay empty: it exists for review findings the
 *  authority cannot express, never as a home for the folk names the naming authority (/docs/star-naming.md#2-authority--one-source-approves-names-everything-else-compiles-them) routes
 *  to aliases. */
export const NAME_OVERRIDES = defineSource({
  ...FROM,
  parse: (input) => parseNameOverrides(input.text(), FROM),
});
