// A fake SIMBAD holding a committed simbad_wds_xids.tsv's objects, for the replay. See README.md#the-committed-table.

import type { FakeSimbad } from '../simbad/simbad-fake-pure';
import { GAIA_DR3, HIP, MAIN_ID, OID, WDS, compose } from '../simbad/simbad-specs-pure';
import { readTable } from '../../util/tsv/table-pure';
import { XIDS, XIDS_COLUMNS } from './simbad-wds-xids-pure';

/** Each row's component under its WDS ident, and each object's main_id, bare HIP and Gaia DR3 id: what the pull wrote is all SIMBAD holds. */
export function xidsFake(text: string, file: string): FakeSimbad {
  const columns = XIDS_COLUMNS.map((c) => c.name);
  const idents: { oid: number; id: string }[] = [];
  const basic = new Map<number, Record<string, string | null>>();
  const objects = new Map<number, string>();
  for (const row of readTable({ file, columns, hint: 'Replay a committed WDS cross-ID pull.' }, text)) {
    const oid = row.requiredId(XIDS.oid);
    idents.push({ oid, id: compose(WDS, `${row.raw(XIDS.wdsId)}${row.raw(XIDS.component)}`) });
    const object = [row.raw(XIDS.mainId), row.raw(XIDS.gaia), row.raw(XIDS.hip)].join('\t');
    const held = objects.get(oid);
    if (held !== undefined) {
      if (held !== object) row.fail(`oid ${oid} is written with two different objects`);
      continue;
    }
    objects.set(oid, object);
    basic.set(oid, { [OID.column]: String(oid), [MAIN_ID.column]: row.text(XIDS.mainId) });
    const gaia = row.text(XIDS.gaia);
    if (gaia !== null) idents.push({ oid, id: compose(GAIA_DR3, gaia) });
    const hip = row.text(XIDS.hip);
    if (hip !== null) idents.push({ oid, id: compose(HIP, hip) });
  }
  return { idents, basic };
}
