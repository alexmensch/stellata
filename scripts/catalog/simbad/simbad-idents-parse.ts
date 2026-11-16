// Parser for data/simbad/simbad_idents.tsv: one object per row, its catalogue keys and designation idents. See /data/simbad/README.md#the-identifier-pull.

import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import type { SimbadIdentsObject } from './simbad-flamsteed-pure';

const SIMBAD_IDENTS_COLUMNS = ['simbad_oid', 'simbad_main_id', 'hip', 'hd', 'gj', 'source_id', 'idents'] as const;

const SEPARATOR = '|';

function integers(cell: string, label: string, fail: (message: string) => never): number[] {
  if (cell === '') return [];
  return cell.split(SEPARATOR).map((v) => (/^\d+$/.test(v) ? Number(v) : fail(`${label} value ${JSON.stringify(v)} is not an integer`)));
}

export function parseSimbadIdentsTsv(text: string, from: Declared): SimbadIdentsObject[] {
  const out: SimbadIdentsObject[] = [];
  for (const row of readTable({ ...from, columns: SIMBAD_IDENTS_COLUMNS, exact: true }, text)) {
    const fail = (message: string): never => row.fail(message);
    out.push({
      oid: row.requiredId('simbad_oid'),
      hips: integers(row.raw('hip'), 'hip', fail),
      hds: integers(row.raw('hd'), 'hd', fail),
      idents: row.raw('idents').split(SEPARATOR),
    });
  }
  return out;
}
