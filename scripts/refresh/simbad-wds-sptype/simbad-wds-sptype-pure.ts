// The WDS-keyed SIMBAD spectral-type pull: its request and its table. See README.md.

import type { Declared } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import type { PullTable } from '../pull/pull';

export const SIMBAD_BATCH_SIZE = 1_000;
/** The least share of the requested oids SIMBAD must still hold: 23,604 of 23,607 held, measured 2026-11-06. */
export const MIN_OID_REACH = 0.99;

/** Every distinct SIMBAD oid simbad_wds_xids.tsv binds a WDS component to, ascending. */
export function wdsOids(text: string, from: Declared): number[] {
  const oids = new Set<number>();
  for (const row of readTable({ ...from, columns: ['simbad_oid'] }, text)) {
    const oid = row.int('simbad_oid');
    if (oid !== null) oids.add(oid);
  }
  return [...oids].sort((a, b) => a - b);
}

export function wdsSptypeTable(oids: readonly number[]): PullTable {
  return {
    from: 'basic',
    columns: [{ name: 'simbad_oid', select: 'oid AS simbad_oid' }, { name: 'sp_type' }],
    sortBy: [{ column: 'simbad_oid', as: 'integer' }],
    scope: {
      kind: 'request',
      key: 'oid',
      idColumn: 'simbad_oid',
      ids: oids.map(String),
      batchSize: SIMBAD_BATCH_SIZE,
      rowsPerId: 1,
      coverage: { groups: [{ name: 'sp_type', has: (cell) => cell('sp_type') !== null }] },
    },
    band: { min: Math.ceil(oids.length * MIN_OID_REACH), max: oids.length },
    spotRows: [
      { key: 'simbad_oid', value: '8399845', cells: { sp_type: 'A0mA1Va' } },
      { key: 'simbad_oid', value: '701944', cells: { sp_type: 'DA2.9' } },
    ],
  };
}
