import { describe, expect, it } from 'vitest';

import { columnTable } from '../../util/tsv/table-pure';
import { batchQueries } from '../pull/pull';
import { SIMBAD, SIMBAD_BATCH_SIZE } from '../pull/tap-pure';
import { MIN_OID_REACH, wdsOids, wdsSptypeTable } from './simbad-wds-sptype-pure';

const FROM = { file: 'wds.tsv', hint: 'test' };

describe('wdsOids', () => {
  it('reads each oid once, ascending, and skips a component SIMBAD left unbound', () => {
    const text = 'wds_id\tcomponent\tsimbad_oid\n1\tA\t300\n1\tB\t\n2\tA\t20\n3\tA\t300\n';
    expect(wdsOids(columnTable(FROM, text))).toEqual([20, 300]);
  });
});

describe('wdsSptypeTable', () => {
  it('asks SIMBAD\'s basic table for each oid\'s sp_type, a batch at a time', () => {
    const oids = Array.from({ length: SIMBAD_BATCH_SIZE + 1 }, (_, i) => i + 1);
    const batches = batchQueries(wdsSptypeTable(oids), SIMBAD.quote);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toBe(`SELECT oid AS simbad_oid, sp_type FROM basic WHERE oid IN (${SIMBAD_BATCH_SIZE + 1})`);
  });

  it('bands the rows between the least reach and one row per oid', () => {
    expect(wdsSptypeTable(Array.from({ length: 1000 }, (_, i) => i)).band).toEqual({ min: 1000 * MIN_OID_REACH, max: 1000 });
  });
});
