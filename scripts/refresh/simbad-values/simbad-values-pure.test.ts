import { describe, expect, it } from 'vitest';

import { declareOutputs } from '../../util/emit-artifacts';
import { fakeAsk } from '../simbad/simbad-fake-pure';
import { record } from '../simbad/simbad-test-fixtures';
import { GAIA_RESOLUTION_FLOORS, MIN_ROW_REACH, resolutionChecks, valuesPull, valuesTable } from './simbad-values-pure';

const BIBCODE = '2020yCat.1350....0G';

describe('valuesTable', () => {
  it('bands the rows between the reach floor and the keyed rows', () => {
    expect(valuesTable(1000).band).toEqual({ min: Math.ceil(1000 * MIN_ROW_REACH), max: 1000 });
  });
});

describe('resolutionChecks', () => {
  const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const bound = (sids: string[]) => new Map(sids.map((sid, i) => [sid, i]));

  it('holds the primaries to their own floor, whatever the magnitude term resolves', () => {
    const primaries = ids(100, 'p');
    const native = ids(100, 'n');
    const [p, n] = resolutionChecks([...primaries, ...native], new Set(native), bound([...primaries.slice(0, 94), ...native]));
    expect([p.kind, n.kind]).toEqual(['fail', 'pass']);
  });

  it('passes a population with no source_ids, since it asked nothing', () => {
    expect(resolutionChecks(['p0'], new Set(), new Map([['p0', 1]]))[1]).toEqual({ kind: 'pass', report: 'Gaia DR3 ident resolution (gaiaNative, 0 source_ids): none asked' });
  });

  it('passes each population at its floor', () => {
    const primaries = ids(100, 'p');
    const native = ids(100, 'n');
    const at = (sids: string[], floor: number) => sids.slice(0, Math.round(floor * 100));
    const checks = resolutionChecks([...primaries, ...native], new Set(native),
      bound([...at(primaries, GAIA_RESOLUTION_FLOORS.primaries), ...at(native, GAIA_RESOLUTION_FLOORS.gaiaNative)]));
    expect(checks.map((c) => c.kind)).toEqual(['pass', 'pass']);
  });
});

describe('valuesPull', () => {
  const pull = (records = [record({ gaiaSourceId: '1', binding: 'reviewed', hip: 7 }), record({ hip: 8 })]) =>
    valuesPull(declareOutputs({ values: 'unused.tsv' }), { records: () => records, gaiaComplete: new Set(), requestFrom: ['manifest.tsv'] });

  it('states the cohort\'s keys as its request', () => {
    expect(pull().request).toEqual({ request: ['source_id:1 hip:7', 'hip:8'], requestFrom: ['manifest.tsv'] });
  });

  it('writes each oid\'s basic cells, idents and bibcoded fluxes, dropping an unattributed one', async () => {
    const { ask } = fakeAsk({
      idents: [{ oid: 100, id: 'Gaia DR3 1' }, { oid: 100, id: 'HIP 7' }, { oid: 200, id: 'HIP 8' }],
      basic: new Map<number, Record<string, string | null>>([
        [100, { main_id: 'A', ra: '1.5', dec: '2.5', coo_bibcode: BIBCODE, plx_value: '3.1', plx_bibcode: null }],
        [200, { main_id: 'B', ra: '4.5', dec: '5.5', coo_bibcode: BIBCODE }],
      ]),
      flux: [
        { oid: 100, filter: 'V', flux: '7.1', fluxErr: '0.01', bibcode: BIBCODE },
        { oid: 200, filter: 'B', flux: '8.2', fluxErr: null, bibcode: null },
      ],
    });
    const { rows, checks } = await pull().run(ask, () => {});
    const [a, b] = rows.values;
    expect(a.slice(0, 6)).toEqual(['100', 'A', '1.5', '2.5', null, BIBCODE]);
    expect(a.slice(10, 14)).toEqual([null, null, null, null]);
    expect(a.slice(19)).toEqual(['7', '1', null, null, null, null, null, '7.1', '0.01', BIBCODE]);
    expect(b.slice(19, 26)).toEqual(['8', null, null, null, null, null, null]);
    expect(checks.map((c) => c.kind)).toEqual(['pass', 'pass', 'pass', 'pass']);
  });

  it('fails the Gaia resolution floor when the cohort\'s source_ids stop resolving', async () => {
    const { ask } = fakeAsk({ idents: [{ oid: 200, id: 'HIP 8' }], basic: new Map([[200, { ra: '1', coo_bibcode: BIBCODE }]]) });
    const { checks } = await pull().run(ask, () => {});
    expect(checks[0]).toMatchObject({ kind: 'fail', message: expect.stringContaining('Gaia DR3 ident resolution (primaries, 1 source_ids) 0.0%') });
  });
});
