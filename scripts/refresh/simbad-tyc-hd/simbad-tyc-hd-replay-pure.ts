// A fake SIMBAD holding a committed simbad_tyc_hd.tsv's objects, for the replay. See README.md#the-committed-table.

import type { FakeSimbad } from '../simbad/simbad-fake-pure';
import { HD_LETTERED, MAIN_ID, OID, TYC, compose } from '../simbad/simbad-specs-pure';
import { readTable } from '../../util/tsv/table-pure';
import { TYC_HD } from './simbad-tyc-hd-pure';

/** SIMBAD's stored spelling: a TYC's first field right-aligned in four, an HD number in six. */
const padTyc = (tyc: string): string => tyc.replace(/^\d+/, (tyc1) => tyc1.padStart(4));
const padHd = (hd: string): string => hd.replace(/^\d+/, (n) => n.padStart(6));

/** Each row's TYC under its object, and each object's main_id and HD ids: what the pull wrote is all SIMBAD holds. */
export function tycHdFake(text: string, file: string): FakeSimbad {
  const idents: { oid: number; id: string }[] = [];
  const basic = new Map<number, Record<string, string | null>>();
  const objects = new Map<number, string>();
  for (const row of readTable({ file, columns: Object.values(TYC_HD), hint: 'Replay a committed TYC → HD pull.' }, text)) {
    const oid = row.requiredId(TYC_HD.oid);
    idents.push({ oid, id: compose(TYC, padTyc(row.raw(TYC_HD.tyc))) });
    const object = `${row.raw(TYC_HD.mainId)}\t${row.raw(TYC_HD.hd)}`;
    const held = objects.get(oid);
    if (held !== undefined) {
      if (held !== object) row.fail(`oid ${oid} is written with two different objects`);
      continue;
    }
    objects.set(oid, object);
    basic.set(oid, { [OID.column]: String(oid), [MAIN_ID.column]: row.text(TYC_HD.mainId) });
    for (const hd of row.raw(TYC_HD.hd).split('|')) idents.push({ oid, id: compose(HD_LETTERED, padHd(hd)) });
  }
  return { idents, basic };
}
