// Identity rows: one per record, its origin key with the attributes the ledger views and trace key on. See README.md#identity--the-origin-source-row.

import { readTable, type TableSpec } from '../../util/tsv/table-pure';
import { compareUtf8 } from './lineage-row-pure';

export const IDENTITY_COLUMNS = ['key', 'tyc', 'hip', 'hd', 'gl', 'gaia_source_id', 'designations'] as const;

export interface IdentityRow {
  readonly key: string;
  readonly tyc: string;
  readonly hip: string;
  readonly hd: string;
  readonly gl: string;
  readonly gaia_source_id: string;
  readonly designations: readonly string[];
}

const DESIGNATION_SEPARATOR = '|';

export function identityText(rows: readonly IdentityRow[]): string {
  const sorted = [...rows].sort((a, b) => compareUtf8(a.key, b.key));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].key === sorted[i - 1].key) throw new Error(`identity: two records keyed ${sorted[i].key}`);
  }
  const lines = sorted.map((r) => {
    const cells = [r.key, r.tyc, r.hip, r.hd, r.gl, r.gaia_source_id, r.designations.join(DESIGNATION_SEPARATOR)];
    if (cells.some((c) => /[\t\n\r]/.test(c))) throw new Error(`identity ${r.key}: a cell contains a TSV delimiter`);
    return cells.join('\t');
  });
  return `${[IDENTITY_COLUMNS.join('\t'), ...lines].join('\n')}\n`;
}

function identitySpec(file: string): TableSpec<(typeof IDENTITY_COLUMNS)[number]> {
  return { file, columns: IDENTITY_COLUMNS, hint: 'Rebuild the stage that writes it.', exact: true };
}

export function* identityRows(text: string, file: string): Generator<IdentityRow> {
  for (const row of readTable(identitySpec(file), text)) {
    const cells = row.cells();
    yield { ...cells, designations: cells.designations === '' ? [] : cells.designations.split(DESIGNATION_SEPARATOR) };
  }
}
