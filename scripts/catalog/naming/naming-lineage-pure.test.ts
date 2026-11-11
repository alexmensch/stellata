import { describe, expect, it } from 'vitest';

import { foldStageLines, paramsOf, type LineageRow } from '../lineage/lineage-row-pure';
import { SEEDED_BRANCH, seededCodeCheck } from '../lineage/count-block-fixture';
import type { NamedRecord } from './display-names';
import { invariantViolations } from '../lineage/lineage-invariant-pure';
import {
  NAMING_CODES, namingLabels, namingLineageLines, namingLineageRows, NAMING_INVARIANTS, namingSummary, type NamingLineageRecord,
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
      { key: 'spine:1', role: 'outcome', code: 'naming.name.own.iau', params: { label: 'Alrakis' } },
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
        key: 'multiples:17053+5408/C', role: 'outcome', code: 'naming.name.borrowed.outranked-identifier.iau',
        params: { label: 'Alrakis C', anchor: 'spine:1', comp: 'C' },
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
      ['naming.name.own.bayer', { label: 'μ¹ Dra B' }],
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

describe('the name row codes', () => {
  it('carry the label\'s tier, one live code per tier an own label or each borrowing rule can display', () => {
    const nameCodes = NAMING_CODES.live.filter((c) => /^naming\.name\.(own|borrowed)\./.test(c));
    expect(nameCodes).toHaveLength(35);
    expect(nameCodes).toContain('naming.name.own.bayer-latin');
    expect(nameCodes).toContain('naming.name.borrowed.system-designation.catalogue');
    expect(nameCodes).toContain('naming.name.borrowed.outranked-identifier.gcvs');
    expect(nameCodes).not.toContain('naming.name.borrowed.outranked-identifier.catalogue');
    expect(NAMING_CODES.live).not.toContain('naming.name.own');
    expect(NAMING_CODES.live).not.toContain('naming.name.borrowed.no-own-designation');
  });

  it('writes a Latin-letter Bayer label under its kebab-case tier', () => {
    const records: NamedRecord[] = [{
      name: { kind: 'own', label: 'p Eri', tier: 'bayer_latin', letter: null },
      set: { bayer: 'p', dc: 'Dra' }, dc: { from: 'designation', con: { via: 'iv27a', index: DRA } },
    }];
    expect(brief(records, [rec('spine:1')])[0].code).toBe('naming.name.own.bayer-latin');
  });
});

describe('the naming count block', () => {
  const records: NamedRecord[] = [
    {
      name: { kind: 'own', label: 'Sirius', tier: 'iau', letter: null },
      set: { iauName: 'Sirius', bayer: 'α', dc: 'CMa' }, dc: { from: 'designation', con: { via: 'wgsn-bayer', index: DRA, displaced: null } },
    },
    {
      name: { kind: 'borrowed', label: 'Sirius B', tier: 'iau', anchorKey: 0, reason: 'no-own-designation', comp: 'B' },
      set: {}, dc: { from: 'none' },
    },
    {
      name: { kind: 'own', label: 'θ¹ Ori C', tier: 'bayer', letter: { source: 'sibling-owns', comp: 'C' } },
      set: { bayer: 'θ', bayerSup: 1, dc: 'Dra' }, dc: { from: 'designation', con: { via: 'gcvs', index: DRA } },
    },
    { name: { kind: 'unlabelled' }, set: {}, dc: { from: 'none' } },
  ];
  const lines = namingLineageLines(records, [rec('spine:1'), rec('spine:2'), rec('spine:3'), rec('gaia_dr3:4')], CONS);

  it('keys every live code, zeros included, and no retired one', () => {
    const counts = foldStageLines(NAMING_CODES, lines);
    expect(Object.keys(counts)).toEqual(NAMING_CODES.live);
    expect(counts).toMatchObject({
      'naming.name.own.iau': 1,
      'naming.name.borrowed.no-own-designation.iau': 1,
      'naming.name.own.bayer': 1,
      'naming.name.unlabelled': 1,
      'naming.name.own.override': 0,
      'naming.dc.gcvs': 1,
      'naming.dc.wgsn-bayer': 1,
    });
  });

  it('logs the composed, name-table, borrowed, lettered and unlabelled figures off the codes', () => {
    const summary = namingSummary(foldStageLines(NAMING_CODES, lines), {
      namingDuplicateLabels: 1, namingDuplicateRecords: 2, namingOverrides: 0,
    });
    expect(summary).toBe(
      'Display names: 3 composed (2 names in catalog.bin, 1 borrowed from a system anchor, 1 lettered, 1 unlabelled)\n'
        + '  1 duplicate label(s) across 2 records — see naming/naming-parity.test.ts',
    );
  });

  it('a new code reaches the snapshot as a key, and fails the check until the snapshot is refreshed', () => {
    const { drift, refreshed } = seededCodeCheck(NAMING_CODES, lines);
    expect(drift.drifted).toBe(true);
    expect(drift.report).toContain(`naming.${SEEDED_BRANCH}`);
    expect(refreshed.drifted).toBe(false);
  });
});

describe('namingLineageRows: every letter and constellation source', () => {
  it('writes the sibling-owns letter and each cascade tier\'s constellation code', () => {
    const records: NamedRecord[] = [
      {
        name: { kind: 'own', label: 'θ¹ Ori C', tier: 'bayer', letter: { source: 'sibling-owns', comp: 'C' } },
        set: { bayer: 'θ', bayerSup: 1, dc: 'Dra' }, dc: { from: 'designation', con: { via: 'iv27a', index: DRA } },
      },
      {
        name: { kind: 'own', label: '21 Dra', tier: 'flamsteed', letter: null },
        set: { flamsteed: 21, dc: 'Dra' }, dc: { from: 'designation', con: { via: 'gcvs', index: DRA } },
      },
      {
        name: { kind: 'own', label: '22 Her', tier: 'flamsteed', letter: null },
        set: { flamsteed: 22, dc: 'Her' }, dc: { from: 'designation', con: { via: 'anchor', index: HER } },
      },
    ];
    expect(brief(records, [rec('spine:1'), rec('spine:2'), rec('spine:3')])
      .filter((r) => !r.code.startsWith('naming.name.'))
      .map((r) => [r.key, r.code, r.params])).toEqual([
      ['spine:1', 'naming.letter.sibling-owns', { comp: 'C' }],
      ['spine:1', 'naming.dc.iv27a', { con: 'Dra' }],
      ['spine:2', 'naming.dc.gcvs', { con: 'Dra' }],
      ['spine:3', 'naming.dc.anchor', { con: 'Her' }],
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
    expect(() => namingLabels([nameRow('spine:1', 'naming.name.own.iau', '{}')])).toThrow(/carries no label/);
  });

  it('refuses two name rows for one record', () => {
    expect(() => namingLabels([
      nameRow('spine:1', 'naming.name.unlabelled', ''),
      nameRow('spine:1', 'naming.name.own.iau', '{"label":"Alrakis"}'),
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
