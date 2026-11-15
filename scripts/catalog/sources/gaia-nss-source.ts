// Gaia DR3 NSS two-body table: the declared table and the catalogue's source_id index.

import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { defineSource } from '../../util/sources/source';
import { groupRowRefs, type GroupRowRef, type RowKeyed } from '../../util/sources/row-ref-pure';
import { columnTable, type ColumnTable } from '../../util/tsv/table-pure';

const GAIA_NSS_COLUMNS = ['source_id'] as const;

/** Only the first column is read — membership is the only signal the cascade needs. */
export function parseNssIndex(
  table: ColumnTable, from: RowKeyed<string, 'group'>,
): Map<string, GroupRowRef<string>> {
  const rows: { key: string; line: number }[] = [];
  for (const row of table(GAIA_NSS_COLUMNS)) {
    const sourceId = row.sourceId('source_id');
    if (sourceId !== null) rows.push({ key: sourceId, line: row.line });
  }
  return groupRowRefs(from, rows);
}

export const GAIA_NSS = defineSource({
  file: DATA_FILES.gaiaNssTwoBody,
  hint: 'Re-run `pnpm run refresh:gaia-nss`.',
  rowKey: { id: 'gaia-dr3-nss', cardinality: 'group', text: (sourceId: string) => sourceId },
  parse: (input) => columnTable({ file: input.file, hint: input.hint }, input.text()),
});
