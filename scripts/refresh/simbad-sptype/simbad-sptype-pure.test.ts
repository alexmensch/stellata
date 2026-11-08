import { describe, expect, it } from 'vitest';

import { declareOutputs } from '../../util/emit-artifacts';
import { fakeAsk } from '../simbad/simbad-fake-pure';
import { record, simbad } from '../simbad/simbad-test-fixtures';
import { ROW_BAND, sptypePull, sptypeTable } from './simbad-sptype-pure';

const outputs = declareOutputs({ sptype: 'unused.tsv' });

describe('sptypeTable', () => {
  it('bands the rows around the manifest\'s keyed rows', () => {
    expect(sptypeTable(1000).band).toEqual({ min: 1000 * ROW_BAND.minOfKeyed, max: 1000 * ROW_BAND.maxOfKeyed });
  });
});

describe('sptypePull', () => {
  const records = [record({ gaiaSourceId: '12345', hip: 777 }), record({ hip: 8 })];
  const pull = sptypePull(outputs, () => records, ['manifest.tsv']);

  it('asks under every manifest key', () => {
    expect(pull.request).toEqual({ request: ['source_id:12345 hip:777', 'hip:8'], requestFrom: ['manifest.tsv'] });
  });

  it('adds the object the union recovers beside the ones Phase A bound, each with its cross-IDs', async () => {
    const { ask } = fakeAsk(simbad(
      { 100: ['Gaia DR3 12345'], 200: ['HIP 8'], 300: ['HIP 777'] },
      { 100: { main_id: 'HD 1A', sp_type: null }, 200: { main_id: 'HD 2', sp_type: 'G2V' }, 300: { main_id: 'HD 1', sp_type: 'K0III' } },
    ));
    const { rows, checks } = await pull.run(ask, () => {});
    expect(rows.sptype.map((r) => [r[0], r[2], r[6], r[7]])).toEqual([
      ['100', null, null, '12345'], ['200', 'G2V', '8', null], ['300', 'K0III', '777', null],
    ]);
    expect(checks.map((c) => c.kind)).toEqual(['pass', 'pass']);
  });

  it('fails the sp_type floor when most objects come back untyped', async () => {
    const { ask } = fakeAsk(simbad({ 100: ['Gaia DR3 12345'], 200: ['HIP 8'] }, { 100: { sp_type: null }, 200: { sp_type: null } }));
    const { checks } = await pull.run(ask, () => {});
    expect(checks[0]).toMatchObject({ kind: 'fail', message: expect.stringContaining('sp_type coverage 0.0%') });
  });
});
