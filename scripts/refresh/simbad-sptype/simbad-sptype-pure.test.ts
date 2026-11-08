import { describe, expect, it } from 'vitest';

import { declareOutputs } from '../../util/emit-artifacts';
import { fakeAsk } from '../simbad/simbad-fake-pure';
import { record, simbad } from '../simbad/simbad-test-fixtures';
import { ROW_BAND, SP_TYPE_FLOORS, sptypePull, sptypeTable, typedByTerm } from './simbad-sptype-pure';

const outputs = declareOutputs({ sptype: 'unused.tsv' });

describe('sptypeTable', () => {
  it('bands the rows around the manifest\'s keyed rows', () => {
    expect(sptypeTable(1000).band).toEqual({ min: 1000 * ROW_BAND.minOfKeyed, max: 1000 * ROW_BAND.maxOfKeyed });
  });
});

describe('typedByTerm', () => {
  const rows = (term: 'primaries' | 'magnitude', n: number, from: number) =>
    Array.from({ length: n }, (_, i) => record({ gaiaSourceId: String(from + i), term }));
  const bound = (n: number, from: number) => Array.from({ length: n }, (_, i) => [String(from + i), from + i] as const);
  const cells = (n: number, from: number, typed: number) =>
    Array.from({ length: n }, (_, i) => [from + i, { sp_type: i < typed ? 'G2V' : null }] as const);

  it('holds each term to its own floor, so the magnitude term cannot hide a primaries drop', () => {
    const records = [...rows('primaries', 100, 0), ...rows('magnitude', 100, 1000)];
    const checks = typedByTerm(records, new Map([...bound(100, 0), ...bound(100, 1000)]),
      new Map([...cells(100, 0, 79), ...cells(100, 1000, 100)]));
    expect(checks.map((c) => c.kind)).toEqual(['fail', 'pass']);
  });

  it('passes each term at its floor, and a term binding nothing', () => {
    const at = (floor: number) => Math.round(floor * 100);
    expect(typedByTerm(rows('primaries', 100, 0), new Map(bound(100, 0)), new Map(cells(100, 0, at(SP_TYPE_FLOORS.primaries))))
      .map((c) => c.kind)).toEqual(['pass', 'pass']);
    expect(typedByTerm(rows('magnitude', 100, 0), new Map(bound(100, 0)), new Map(cells(100, 0, at(SP_TYPE_FLOORS.magnitude))))
      .map((c) => c.kind)).toEqual(['pass', 'pass']);
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
    const { rows } = await pull.run(ask, () => {});
    expect(rows.sptype.map((r) => [r[0], r[2], r[6], r[7]])).toEqual([
      ['100', null, null, '12345'], ['200', 'G2V', '8', null], ['300', 'K0III', '777', null],
    ]);
  });

  it('fails the sp_type floor when most objects come back untyped', async () => {
    const { ask } = fakeAsk(simbad({ 100: ['Gaia DR3 12345'], 200: ['HIP 8'] }, { 100: { sp_type: null }, 200: { sp_type: null } }));
    const { checks } = await pull.run(ask, () => {});
    expect(checks[0]).toMatchObject({ kind: 'fail', message: expect.stringContaining('sp_type coverage (primaries, 1 objects) 0.0%') });
  });
});
