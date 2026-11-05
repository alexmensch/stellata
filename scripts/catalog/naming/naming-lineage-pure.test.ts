import { describe, expect, it } from 'vitest';

import { paramsOf, type LineageRow } from '../lineage/lineage-row-pure';
import type { NamedRecord } from './display-names';
import { invariantViolations } from '../lineage/lineage-invariant-pure';
import {
  namingLabels, namingLineageLines, namingLineageRows, NAMING_INVARIANTS, type NamingLineageRecord,
} from './naming-lineage-pure';

const CONS = [{ code: 'Dra' }, { code: 'Her' }];
const DRA = 0;
const HER = 1;

const rec = (originKey: string): NamingLineageRecord => ({ originKey });

const brief = (records: NamedRecord[], stars: NamingLineageRecord[]) =>
  [...namingLineageRows(records, stars, CONS)].map((r) => ({ key: r.key, role: r.role, code: r.code, params: paramsOf(r) }));

describe('namingLineageRows', () => {
  it('writes the winning tier, every lower tier it refused, and the constellation the set renders against', () => {
    const records: NamedRecord[] = [{
      name: { kind: 'own', label: 'Alrakis', tier: 'iau', letter: null },
      set: { iauName: 'Alrakis', bayer: 'μ', bayerSup: 1, flamsteed: 21, hip: 83608, dc: 'Dra' },
      dc: { from: 'designation', con: { via: 'wgsn-bayer', index: DRA, displaced: HER } },
    }];
    expect(brief(records, [rec('spine:1')])).toEqual([
      { key: 'spine:1', role: 'outcome', code: 'naming.name.own', params: { tier: 'iau', label: 'Alrakis' } },
      { key: 'spine:1', role: 'refused', code: 'naming.name.lower-tier', params: { tier: 'bayer', label: 'μ¹ Dra' } },
      { key: 'spine:1', role: 'refused', code: 'naming.name.lower-tier', params: { tier: 'flamsteed', label: '21 Dra' } },
      { key: 'spine:1', role: 'refused', code: 'naming.name.lower-tier', params: { tier: 'catalogue', label: 'HIP 83608' } },
      { key: 'spine:1', role: 'outcome', code: 'naming.dc.wgsn-bayer', params: { con: 'Dra' } },
      { key: 'spine:1', role: 'refused', code: 'naming.dc.displaced', params: { con: 'Her' } },
    ]);
  });

  it('names a borrowed label\'s anchor by origin key, refuses the record\'s own, and sources its letter', () => {
    const records: NamedRecord[] = [
      { name: { kind: 'own', label: 'Alrakis', tier: 'iau', letter: null }, set: { iauName: 'Alrakis' }, dc: { from: 'none' } },
      {
        name: { kind: 'borrowed', label: 'Alrakis C', tier: 'iau', anchorKey: 0, reason: 'outranked-identifier', comp: 'C' },
        set: { hip: 83609 },
        dc: { from: 'positional', index: DRA },
      },
    ];
    expect(brief(records, [rec('spine:1'), rec('multiples:17053+5408/C')]).slice(1)).toEqual([
      {
        key: 'multiples:17053+5408/C', role: 'outcome', code: 'naming.name.borrowed.outranked-identifier',
        params: { tier: 'iau', label: 'Alrakis C', anchor: 'spine:1', comp: 'C' },
      },
      { key: 'multiples:17053+5408/C', role: 'refused', code: 'naming.name.borrowed-over', params: { tier: 'catalogue', label: 'HIP 83609' } },
      { key: 'multiples:17053+5408/C', role: 'outcome', code: 'naming.letter.borrowed', params: { comp: 'C' } },
    ]);
  });

  it('writes the letter an own label carries, and the positional fallback', () => {
    const records: NamedRecord[] = [{
      name: { kind: 'own', label: 'μ¹ Dra B', tier: 'bayer', letter: { source: 'stated', comp: 'B' } },
      set: { bayer: 'μ', bayerSup: 1, dc: 'Dra' },
      dc: { from: 'positional', index: DRA },
    }];
    expect(brief(records, [rec('spine:2')]).map((r) => [r.code, r.params])).toEqual([
      ['naming.name.own', { tier: 'bayer', label: 'μ¹ Dra B' }],
      ['naming.letter.stated', { comp: 'B' }],
      ['naming.dc.positional', { con: 'Dra' }],
    ]);
  });

  it('writes an unlabelled record, and no constellation row for a set with no sky designation', () => {
    const records: NamedRecord[] = [{ name: { kind: 'unlabelled' }, set: {}, dc: { from: 'positional', index: DRA } }];
    expect(brief(records, [rec('gaia_dr3:1')])).toEqual([
      { key: 'gaia_dr3:1', role: 'outcome', code: 'naming.name.unlabelled', params: {} },
    ]);
  });
});

describe('namingLabels', () => {
  it('reads each record\'s label off its name row alone', () => {
    const records: NamedRecord[] = [
      {
        name: { kind: 'own', label: 'Alrakis', tier: 'iau', letter: null },
        set: { iauName: 'Alrakis', hip: 83608 }, dc: { from: 'none' },
      },
      {
        name: { kind: 'borrowed', label: 'Alrakis C', tier: 'iau', anchorKey: 0, reason: 'no-own-designation', comp: 'C' },
        set: {}, dc: { from: 'none' },
      },
      { name: { kind: 'unlabelled' }, set: {}, dc: { from: 'none' } },
    ];
    const rows = namingLineageRows(records, [rec('spine:1'), rec('spine:2'), rec('gaia_dr3:3')], CONS);
    expect([...namingLabels(rows)]).toEqual([['spine:1', 'Alrakis'], ['spine:2', 'Alrakis C'], ['gaia_dr3:3', null]]);
  });

  const nameRow = (key: string, code: string, params: string): LineageRow =>
    ({ stage: 'naming', key, role: 'outcome', code, params, evidence: [] });

  it('refuses a labelled name row that carries no label', () => {
    expect(() => namingLabels([nameRow('spine:1', 'naming.name.own', '{"tier":"iau"}')])).toThrow(/carries no label/);
  });

  it('refuses two name rows for one record', () => {
    expect(() => namingLabels([
      nameRow('spine:1', 'naming.name.unlabelled', ''),
      nameRow('spine:1', 'naming.name.own', '{"tier":"iau","label":"Alrakis"}'),
    ])).toThrow(/two name rows/);
  });
});

describe('NAMING_INVARIANTS', () => {
  it('names a record whose sky designation has no constellation to render against', () => {
    const records: NamedRecord[] = [
      { name: { kind: 'own', label: 'HIP 1', tier: 'catalogue', letter: null }, set: { flamsteed: 21, hip: 1 }, dc: { from: 'none' } },
      { name: { kind: 'own', label: 'HIP 2', tier: 'catalogue', letter: null }, set: { hip: 2 }, dc: { from: 'none' } },
    ];
    const [none] = invariantViolations(NAMING_INVARIANTS, namingLineageLines(records, [rec('spine:1'), rec('spine:2')], CONS));
    expect(none.rows.map((r) => r.key)).toEqual(['spine:1']);
  });
});
