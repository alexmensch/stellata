import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EmissionRefused, declareOutputs } from '../../util/emit-artifacts';
import { runPull } from '../pull/pull';
import { SIMBAD, type TapClientDeps } from '../pull/tap-pure';
import { wdsSptypeTable } from './simbad-wds-sptype-pure';

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
    tables: { sptype: wdsSptypeTable(oids) },
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
