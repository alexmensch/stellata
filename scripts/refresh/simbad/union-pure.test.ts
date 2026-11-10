import { describe, expect, it } from 'vitest';

import type { ManifestRecord } from '../../catalog/membership/membership-manifest-tsv';
import { fakeAsk } from './simbad-fake-pure';
import { parseLedger, simbadPhases, type BasicCells } from './simbad-fetch-pure';
import { GAIA_DR3, HIP, MAIN_ID, OID, SP_TYPE, WIDENING_LADDER } from './simbad-specs-pure';
import { record, simbad } from './simbad-test-fixtures';
import { UNION_NAMESPACES, recoveredRows, unionUnanswered } from './union-pure';

const PHASES = simbadPhases({ basic: [OID, MAIN_ID, SP_TYPE], idents: [HIP] });

type Bindings = Record<string, Record<string, number>>;

async function union(
  records: ManifestRecord[], bindings: Bindings, rows: Record<number, BasicCells>,
  ids: Record<number, readonly string[]>, basic: Record<number, BasicCells> = {},
) {
  const fake = fakeAsk(simbad(ids, basic));
  const result = await unionUnanswered(fake.ask, PHASES, parseLedger(), {
    records: () => records,
    bindings: new Map(Object.entries(bindings).map(([ns, b]) => [ns, new Map(Object.entries(b))])),
    rows: new Map(Object.entries(rows).map(([oid, cells]) => [Number(oid), cells])),
    value: SP_TYPE.column,
  });
  return { ...result, asked: fake.asked.map((a) => a.phase.from) };
}

const ROW = record({ gaiaSourceId: '12345', hip: 777 });
const UNTYPED = { 100: { sp_type: null } };

describe('unionUnanswered', () => {
  it('recovers a row whose bound object carries no value, through a namespace Phase A never asked', async () => {
    const { found, added, report } = await union([ROW], { source_id: { 12345: 100 } }, UNTYPED,
      { 300: ['HIP 777'] }, { 300: { main_id: 'HD 1A', sp_type: 'K0III' } });
    expect(found).toEqual(new Map([[300, { oid: '300', main_id: 'HD 1A', sp_type: 'K0III' }]]));
    expect(added).toEqual(new Map([['hip', new Map([['777', 300]])]]));
    expect([report.unanswered, report.withUnaskedNamespace, report.rowsRecovered]).toEqual([1, 1, 1]);
    expect(report.verdicts.get('hip')?.uncorroborated).toBe(1);
  });

  it('asks nothing for a row its bound object answers', async () => {
    const { found, added, report, asked } = await union([ROW], { source_id: { 12345: 100 } }, { 100: { sp_type: 'G2V' } }, {});
    expect([found.size, added.size, report.answered]).toEqual([0, 0, 1]);
    expect(asked).toEqual([]);
  });

  it('vetoes a binding SIMBAD names another DR3 source for, before asking the basic table', async () => {
    const { found, added, report, asked } = await union([ROW], { source_id: { 12345: 100 } }, UNTYPED,
      { 300: ['HIP 777', 'Gaia DR3 999'] }, { 300: { sp_type: 'K0III' } });
    expect(found.size).toBe(0);
    expect(added.get('hip')).toEqual(new Map());
    expect(report.verdicts.get('hip')?.vetoed).toBe(1);
    expect(report.rowsRecovered).toBe(0);
    expect(asked).not.toContain('basic');
  });

  it('corroborates on the asking id held under an earlier release', async () => {
    const { added, report } = await union([ROW], { source_id: { 12345: 100 } }, UNTYPED,
      { 300: ['HIP 777', 'Gaia DR2 12345', 'Gaia DR3 999'] }, { 300: { sp_type: 'K0III' } });
    expect(added.get('hip')).toEqual(new Map([['777', 300]]));
    expect(report.verdicts.get('hip')).toEqual({ corroborated: 1, vetoed: 0, uncorroborated: 0 });
  });

  it('leaves a designation two source_ids claim unadjudicated', async () => {
    const { added, report } = await union(
      [ROW, record({ gaiaSourceId: '23456', hip: 777 })],
      { source_id: { 12345: 100, 23456: 101 } }, { ...UNTYPED, 101: { sp_type: null } },
      { 300: ['HIP 777', 'Gaia DR3 999'] }, { 300: { sp_type: 'K0III' } },
    );
    expect(added.get('hip')).toEqual(new Map([['777', 300]]));
    expect(report.verdicts.get('hip')).toEqual({ corroborated: 0, vetoed: 0, uncorroborated: 1 });
    expect(report.rowsRecovered).toBe(2);
  });

  it('drops an object that answers with the value empty', async () => {
    const { found, added, report } = await union([ROW], { source_id: { 12345: 100 } }, UNTYPED,
      { 300: ['HIP 777'] }, { 300: { sp_type: ' ' } });
    expect(found.size).toBe(0);
    expect(added.get('hip')).toEqual(new Map());
    expect(report.rowsRecovered).toBe(0);
  });

  it('credits a row reaching an object Phase B already holds, adding no row', async () => {
    const { found, added, report, asked } = await union(
      [ROW, record({ gaiaSourceId: '999', hip: 777 })],
      { source_id: { 999: 100 } }, { 100: { sp_type: 'K0III' } }, { 100: ['HIP 777'] },
    );
    expect(found.size).toBe(0);
    expect(added.get('hip')).toEqual(new Map([['777', 100]]));
    expect(asked).not.toContain('basic');
    expect([report.unanswered, report.rowsRecovered]).toEqual([1, 1]);
  });

  it('does not re-ask a namespace that already bound the row', async () => {
    const { report } = await union([record({ gaiaSourceId: '12345', hip: 777, tyc: '1-2-1' })],
      { source_id: { 12345: 100 }, hip: { 777: 100 } }, UNTYPED, {});
    expect([report.requested.get('hip'), report.requested.get('tyc')]).toEqual([0, 1]);
  });

  it('skips, in a later namespace, a row an earlier one recovered', async () => {
    const { found, report } = await union([record({ gaiaSourceId: '12345', hip: 777, tyc: '1-2-1' })],
      { source_id: { 12345: 100 } }, UNTYPED, { 300: ['HIP 777'] }, { 300: { sp_type: 'K0III' } });
    expect([...found.keys()]).toEqual([300]);
    expect(report.requested.get('tyc')).toBe(0);
  });

  it('asks the widening ladder and no Gaia rung', () => {
    expect(UNION_NAMESPACES).toEqual(WIDENING_LADDER);
    expect(UNION_NAMESPACES.map((ns) => ns.name)).not.toContain(GAIA_DR3.name);
  });
});

describe('recoveredRows', () => {
  it('answers for the cohort the filter keeps', () => {
    const records = [ROW, record({ gaiaSourceId: '23456', hip: 778 })];
    const added = new Map([['hip', new Map([['777', 300], ['778', 301]])]]);
    const tail = (rows: Iterable<readonly [ManifestRecord, string, number]>) => [...rows].map(([, ns, oid]) => [ns, oid]);
    expect(tail(recoveredRows(records, added))).toEqual([['hip', 300], ['hip', 301]]);
    expect(tail(recoveredRows(records, added, (r) => r.hip === 777))).toEqual([['hip', 300]]);
  });
});
