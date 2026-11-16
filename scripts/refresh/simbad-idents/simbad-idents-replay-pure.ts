// A fake SIMBAD holding a committed simbad_idents.tsv's objects, for the replay. See README.md#the-committed-table.

import type { FakeSimbad } from '../simbad/simbad-fake-pure';
import { GAIA_DR3, GJ, HD, HIP, MAIN_ID, OID, compose, type Namespace } from '../simbad/simbad-specs-pure';
import { readTable } from '../../util/tsv/table-pure';
import { IDENTS, IDENTS_PHASES, VALUE_SEPARATOR, WHOLE_SKY_CLASSES } from './simbad-idents-pure';

const KEY_CELLS: readonly [string, Namespace][] = [[IDENTS.hip, HIP], [IDENTS.hd, HD], [IDENTS.gj, GJ], [IDENTS.sourceId, GAIA_DR3]];

/** Each row's idents and keys under its object, the whole-sky classes as the whole-table answer: what the pull wrote is all SIMBAD holds. */
export function identsFake(text: string, file: string): FakeSimbad {
  const idents: { oid: number; id: string }[] = [];
  const basic = new Map<number, Record<string, string | null>>();
  const wholeSky: [string, string][] = [];
  for (const row of readTable({ file, columns: Object.values(IDENTS), hint: 'Replay a committed identifier pull.' }, text)) {
    const oid = row.requiredId(IDENTS.oid);
    basic.set(oid, { [OID.column]: String(oid), [MAIN_ID.column]: row.text(IDENTS.mainId) });
    for (const id of row.raw(IDENTS.idents).split(VALUE_SEPARATOR)) {
      idents.push({ oid, id });
      if (WHOLE_SKY_CLASSES.some((c) => id.startsWith(c.prefix))) wholeSky.push([String(oid), id]);
    }
    for (const [cell, ns] of KEY_CELLS) {
      const values = row.raw(cell);
      if (values !== '') for (const value of values.split(VALUE_SEPARATOR)) idents.push({ oid, id: compose(ns, value) });
    }
  }
  return { idents, basic, wholeTables: new Map([[IDENTS_PHASES.wholeSky, wholeSky]]) };
}
