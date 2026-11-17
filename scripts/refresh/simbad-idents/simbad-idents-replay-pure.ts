// A fake SIMBAD holding a committed simbad_idents.tsv's objects, for the replay. See README.md#the-committed-table.

import type { FakeSimbad } from '../simbad/simbad-fake-pure';
import { GAIA_DR3, GJ, HD, HIP, MAIN_ID, OID, compose, type Namespace } from '../simbad/simbad-specs-pure';
import { readTable } from '../../util/tsv/table-pure';
import { IDENTS_COLUMN, IDENTS_SEPARATOR } from '../../catalog/simbad/simbad-idents-parse';
import { IDENTS_PHASES, WHOLE_SKY_CLASSES } from './simbad-idents-pure';

const KEY_CELLS = [[IDENTS_COLUMN.hip, HIP], [IDENTS_COLUMN.hd, HD], [IDENTS_COLUMN.gj, GJ], [IDENTS_COLUMN.sourceId, GAIA_DR3]] as const satisfies readonly (readonly [string, Namespace])[];

/** Each row's idents and keys under its object, the whole-sky classes as the whole-table answer: what the pull wrote is all SIMBAD holds. */
export function identsFake(text: string, file: string): FakeSimbad {
  const idents: { oid: number; id: string }[] = [];
  const basic = new Map<number, Record<string, string | null>>();
  const wholeSky: [string, string][] = [];
  for (const row of readTable({ file, columns: Object.values(IDENTS_COLUMN), hint: 'Replay a committed identifier pull.' }, text)) {
    const oid = row.requiredId(IDENTS_COLUMN.oid);
    basic.set(oid, { [OID.column]: String(oid), [MAIN_ID.column]: row.text(IDENTS_COLUMN.mainId) });
    for (const id of row.raw(IDENTS_COLUMN.idents).split(IDENTS_SEPARATOR)) {
      idents.push({ oid, id });
      if (WHOLE_SKY_CLASSES.some((c) => id.startsWith(c.prefix))) wholeSky.push([String(oid), id]);
    }
    for (const [cell, ns] of KEY_CELLS) {
      const values = row.raw(cell);
      if (values !== '') for (const value of values.split(IDENTS_SEPARATOR)) idents.push({ oid, id: compose(ns, value) });
    }
  }
  return { idents, basic, wholeTables: new Map([[IDENTS_PHASES.wholeSky, wholeSky]]) };
}
