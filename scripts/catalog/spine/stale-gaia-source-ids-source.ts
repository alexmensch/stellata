// The spine source_ids Gaia DR3 publishes no row for, with their SIMBAD successors, declared.

import { defineSource } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';

const COLUMNS = ['gaia_source_id', 'simbad_oid', 'simbad_dr3_source_id'] as const;

export const STALE_GAIA_SOURCE_IDS = defineSource({
  file: 'data/athyg/stale_gaia_source_ids.tsv',
  hint: 'Re-derive it from the spine, the 5p pull and the SIMBAD values pull.',
  parse: (input): Record<(typeof COLUMNS)[number], string>[] =>
    [...readTable({ ...input, columns: COLUMNS }, input.text())]
      .map((row) => Object.fromEntries(COLUMNS.map((c) => [c, row.text(c) ?? ''])) as Record<(typeof COLUMNS)[number], string>),
});
