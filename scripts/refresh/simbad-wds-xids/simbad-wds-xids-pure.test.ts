import { describe, expect, it } from 'vitest';

import { declareOutputs } from '../../util/emit-artifacts';
import { describePhasedPull, type Ask } from '../pull/pull';
import { fakeAsk, type FakeSimbad } from '../simbad/simbad-fake-pure';
import { MIN_COMPONENT_REACH, XIDS_PHASES, xidsPull, xidsTable } from './simbad-wds-xids-pure';
import type { WdsComponent } from './wds-components-pure';
import type { WdsXidOverride } from './wds-xids-overrides-pure';

const OUTPUTS = declareOutputs({ xids: 'xids.tsv' });
const c = (wdsId: string, component: string): WdsComponent => ({ wdsId, component });

function fake(objects: Record<number, { mainId: string; ids: readonly string[] }>): FakeSimbad {
  return {
    idents: Object.entries(objects).flatMap(([oid, o]) => o.ids.map((id) => ({ oid: Number(oid), id }))),
    basic: new Map(Object.entries(objects).map(([oid, o]) => [Number(oid), { oid, main_id: o.mainId }])),
  };
}

async function run(simbad: FakeSimbad, components: readonly WdsComponent[], overrides: readonly WdsXidOverride[] = []) {
  const pull = xidsPull(OUTPUTS, { components, overrides, overridesFile: 'o.tsv', requestFrom: ['wds.txt', 'o.tsv'] });
  const { ask, asked } = fakeAsk(simbad);
  const log: string[] = [];
  const result = await pull.run(ask, (line) => log.push(line));
  return { rows: result.rows.xids, checks: result.checks, asked, log };
}

describe('xidsPull', () => {
  it('writes each component\'s main_id, Gaia DR3 id and HIP, a lettered HIP on its own letter, and an object with neither', async () => {
    const simbad = fake({
      232913: { mainId: 'BD+47  2846', ids: ['WDS J19290+4758A', 'Gaia DR3 2129256395211984000'] },
      1001: { mainId: '* xi UMa B', ids: ['WDS J11182+3132B', 'HIP 55203B', 'Gaia DR3 777'] },
      2002: { mainId: '* alf Cen A', ids: ['WDS J14396-6050A'] },
    });
    const { rows, checks } = await run(simbad, [c('11182+3132', 'B'), c('14396-6050', 'A'), c('19290+4758', 'A'), c('20000+0000', 'A')]);
    expect(rows).toEqual([
      ['11182+3132', 'B', '1001', '* xi UMa B', '777', '55203'],
      ['14396-6050', 'A', '2002', '* alf Cen A', null, null],
      ['19290+4758', 'A', '232913', 'BD+47  2846', '2129256395211984000', null],
    ]);
    expect(checks.every((check) => check.kind === 'pass')).toBe(true);
  });

  it('refuses a WDS ident SIMBAD answers under two objects', async () => {
    const simbad = fake({ 1: { mainId: 'a', ids: ['WDS J06451-1643A'] }, 2: { mainId: 'b', ids: ['WDS J06451-1643A'] } });
    await expect(run(simbad, [c('06451-1643', 'A')])).rejects.toThrow(/WDS J06451-1643A → 1 and 2/);
  });

  it('refuses a WDS ident answer that names no component the request asked', async () => {
    const pull = xidsPull(OUTPUTS, { components: [c('06451-1643', 'A')], overrides: [], overridesFile: 'o.tsv', requestFrom: [] });
    const stray: Ask = async () => [['1', 'WDS J06451-1643A'], ['2', 'WDS J99999+9999Z']];
    await expect(pull.run(stray, () => {})).rejects.toThrow(/WDS J99999\+9999Z, which names no component/);
  });

  it('drops and logs a WDS ident answered only under SIMBAD\'s case-folded match, leaving the asked component to the cascade', async () => {
    const simbad = fake({
      10: { mainId: 'primary', ids: ['WDS J01234+5678A', 'HD   1234'] },
      20: { mainId: 'pair AB', ids: ['WDS J01234+5678AB'] },
      30: { mainId: 'secondary b', ids: ['HD   1234Ab'] },
    });
    const { rows, log } = await run(simbad, [c('01234+5678', 'A'), c('01234+5678', 'Ab')]);
    expect(rows.map((r) => r.slice(0, 3))).toEqual([['01234+5678', 'A', '10'], ['01234+5678', 'Ab', '30']]);
    expect(log).toContain('  WDS ident answered only case-folded, bound to none: WDS J01234+5678AB → 20');
  });

  it('recovers Sirius B through its letter on Sirius A\'s HD, asking aliases only of a system with an unresolved component', async () => {
    const simbad = fake({
      8399845: { mainId: '* alf CMa', ids: ['WDS J06451-1643A', 'HD  48915', 'HIP 32349'] },
      930049: { mainId: '* alf CMa B', ids: ['HD  48915B', 'Gaia DR3 2947050466531873024'] },
      5: { mainId: 'lone', ids: ['WDS J00001+0001A'] },
    });
    const { rows, asked, log } = await run(simbad, [c('00001+0001', 'A'), c('06451-1643', 'A'), c('06451-1643', 'B')]);
    expect(rows.map((r) => r.slice(0, 5))).toEqual([
      ['00001+0001', 'A', '5', 'lone', null],
      ['06451-1643', 'A', '8399845', '* alf CMa', null],
      ['06451-1643', 'B', '930049', '* alf CMa B', '2947050466531873024'],
    ]);
    expect(asked.find((a) => a.phase === XIDS_PHASES.aliases)?.ids).toEqual(['8399845']);
    expect(log).toContain('cascade: 3 candidates, 1 components recovered (alias hits HD 1, CCDM 0, HIP 0)');
  });

  it('lets an override replace what the ident lookup found', async () => {
    const simbad = fake({ 1: { mainId: 'found', ids: ['WDS J06451-1643B'] }, 2: { mainId: 'curated', ids: [] } });
    const { rows } = await run(simbad, [c('06451-1643', 'B')], [{ wdsId: '06451-1643', component: 'B', oid: 2 }]);
    expect(rows).toEqual([['06451-1643', 'B', '2', 'curated', null, null]]);
  });

  it('fails an override on an object SIMBAD\'s basic table does not hold', async () => {
    const { checks } = await run(fake({ 1: { mainId: 'found', ids: ['WDS J06451-1643B'] } }), [c('06451-1643', 'B')], [{ wdsId: '06451-1643', component: 'B', oid: 999 }]);
    expect(checks.find((check) => check.kind === 'fail')).toMatchObject({ message: expect.stringMatching(/o\.tsv pins 1 objects .*: 06451-1643 B → 999$/) });
  });

  it('fails the parse ledger on a Gaia DR3 id no namespace rule reads', async () => {
    const { checks } = await run(fake({ 1: { mainId: 'x', ids: ['WDS J06451-1643A', 'Gaia DR3 1.5'] } }), [c('06451-1643', 'A')]);
    expect(checks.map((check) => check.kind)).toEqual(['fail', 'pass']);
  });

  it('refuses an override on no WDS component before asking anything', () => {
    expect(() => xidsPull(OUTPUTS, { components: [c('06451-1643', 'A')], overrides: [{ wdsId: '9', component: 'Z', oid: 1 }], overridesFile: 'o.tsv', requestFrom: [] }))
      .toThrow(/o\.tsv names 1 components/);
  });

  it('describes every phase it asks, and its request off the WDS summary and the overrides', () => {
    const description = describePhasedPull(xidsPull(OUTPUTS, {
      components: [c('06451-1643', 'A')], overrides: [{ wdsId: '06451-1643', component: 'A', oid: 7 }], overridesFile: 'o.tsv', requestFrom: ['wds.txt', 'o.tsv'],
    }));
    expect(Object.keys(JSON.parse(description.query).phases)).toEqual(['resolve', 'aliases', 'cascade', 'basic', 'xrefs']);
    expect(description).toMatchObject({ request: ['WDS J06451-1643A', 'override 06451-1643 A 7'], requestFrom: ['wds.txt', 'o.tsv'], services: expect.any(Array) });
  });

  it('bands the rows between the least reach and one per component', () => {
    expect(xidsTable(1000).band).toEqual({ min: Math.ceil(1000 * MIN_COMPONENT_REACH), max: 1000 });
  });
});
