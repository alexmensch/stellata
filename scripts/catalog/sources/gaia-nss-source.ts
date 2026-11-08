// Gaia DR3 NSS two-body table: the declared table and the catalogue's source_id index.

import { defineSource } from '../../util/sources/source';
import {
  sourceRowRef, type RowKeyed, type SourceRowRef,
} from '../../util/sources/row-ref-pure';
import { columnTable, type ColumnTable } from '../../util/tsv/table-pure';

const GAIA_NSS_COLUMNS = ['source_id'] as const;

/** Only the first column is read — membership is the only signal the cascade needs. */
export function parseNssIndex(
  table: ColumnTable, from: RowKeyed<string>,
): Map<string, SourceRowRef<string>> {
  const out = new Map<string, SourceRowRef<string>>();
  for (const row of table(GAIA_NSS_COLUMNS)) {
    const sourceId = row.sourceId('source_id');
    if (sourceId !== null) out.set(sourceId, sourceRowRef(from, sourceId));
  }
  return out;
}

export const GAIA_NSS = defineSource({
  file: 'data/gaia/gaia_dr3_nss_two_body.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-nss`.',
  rowKey: { id: 'gaia-dr3-nss', text: (sourceId: string) => sourceId },
  parse: (input) => columnTable({ file: input.file, hint: input.hint }, input.text()),
});
