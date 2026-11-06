import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EmissionRefused, declareOutputs } from '../../util/emit-artifacts';
import { batchQueries, runPull } from '../pull/pull';
import { SIMBAD, SIMBAD_BATCH_SIZE, type TapClientDeps } from '../pull/tap-pure';
import { MIN_OID_REACH, wdsOids, wdsSptypeTable } from './simbad-wds-sptype-pure';

const FROM = { file: 'wds.tsv', hint: 'test' };

describe('wdsOids', () => {
  it('reads each oid once, ascending, and skips a component SIMBAD left unbound', () => {
    const text = 'wds_id\tcomponent\tsimbad_oid\n1\tA\t300\n1\tB\t\n2\tA\t20\n3\tA\t300\n';
    expect(wdsOids(text, FROM)).toEqual([20, 300]);
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

describe('the pull', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'wds-sptype-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const deps = (body: string): TapClientDeps => ({
    transport: async (_url, form) => (form
      ? { status: 200, contentType: 'text/csv', body }
      : { status: 200, contentType: 'text/xml', body: '<capabilities/>' }),
    sleep: async () => {},
    report: () => {},
    log: () => {},
  });

  const pullOf = (oids: readonly number[]) => ({
    archive: SIMBAD,
    outputs: declareOutputs({ sptype: join(dir, 'sptype.tsv') }),
    tables: { sptype: { ...wdsSptypeTable(oids), band: { min: 1, max: oids.length } } },
  });

  it('writes oid order, an unclassified oid as an empty sp_type', async () => {
    await runPull(pullOf([1, 701944, 8399845]), deps('simbad_oid,sp_type\n8399845,"A0mA1Va"\n1,\n701944,"DA2.9"\n'));
    expect(readFileSync(join(dir, 'sptype.tsv'), 'utf8')).toBe('simbad_oid\tsp_type\n1\t\n701944\tDA2.9\n8399845\tA0mA1Va\n');
  });

  it('refuses a re-typed spot row', async () => {
    const drifted = deps('simbad_oid,sp_type\n8399845,"A1V"\n701944,"DA2.9"\n');
    await expect(runPull(pullOf([701944, 8399845]), drifted)).rejects.toThrow(EmissionRefused);
  });
});
