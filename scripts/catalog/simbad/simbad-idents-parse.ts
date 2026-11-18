// Parser for data/simbad/simbad_idents.tsv: one object per row, its catalogue keys and designation idents. See /data/simbad/README.md#the-identifier-pull.

import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import type { SimbadIdentsObject } from './simbad-flamsteed-pure';

/** The table's column names, in file order. */
export const IDENTS_COLUMN = {
  oid: 'simbad_oid', mainId: 'simbad_main_id', hip: 'hip', hd: 'hd', gj: 'gj', sourceId: 'source_id', idents: 'idents',
} as const;

/** The values one cell joins. */
export const IDENTS_SEPARATOR = '|';

export function parseSimbadIdentsTsv(text: string, from: Declared): SimbadIdentsObject[] {
  const out: SimbadIdentsObject[] = [];
  for (const row of readTable({ ...from, columns: Object.values(IDENTS_COLUMN), exact: true }, text)) {
    out.push({
      oid: row.requiredId(IDENTS_COLUMN.oid),
      hips: row.idList(IDENTS_COLUMN.hip, IDENTS_SEPARATOR),
      hds: row.idList(IDENTS_COLUMN.hd, IDENTS_SEPARATOR),
      sourceIds: row.raw(IDENTS_COLUMN.sourceId).split(IDENTS_SEPARATOR).filter((id) => id !== ''),
      idents: row.raw(IDENTS_COLUMN.idents).split(IDENTS_SEPARATOR),
    });
  }
  return out;
}
