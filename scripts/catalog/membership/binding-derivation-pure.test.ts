import { describe, expect, it } from 'vitest';

import { parseSimbadWdsXidsTsv } from '../record/catalog-pure';
import { bindingEvidence } from '../classic-ids/classic-id-overlay-pure';
import { cns5Row } from '../classic-ids/cns5-fixture';
import { indexCns5, type BindingTables, type SimbadXids } from '../spine/primaries-audit-pure';
import {
  bindingCandidates,
  bindingClassOf,
  derivationCandidateSourceIds,
  deriveBinding,
  indexSimbadSources,
  rankCandidates,
  rowGateEvidence,
  simbadCandidate,
  type BindingCandidates,
} from './binding-derivation-pure';
import { NO_PRINTED_V_BELOW_HIP } from '../photometry/photometry-fixture';

const simbadBySourceId = new Map<string, SimbadXids>([
  ['100', { hip: 10, tyc: '1-1-1', gj: null }],
  ['200', { hip: null, tyc: '2-2-1', gj: '820 A' }],
  ['201', { hip: null, tyc: null, gj: '820 B' }],
  ['300', { hip: 30, tyc: null, gj: null }],
  ['301', { hip: 30, tyc: null, gj: null }],
  ['400', { hip: null, tyc: null, gj: '9140' }],
  ['866', { hip: null, tyc: null, gj: '866 C' }],
]);
const simbad = indexSimbadSources(simbadBySourceId);

const tables: BindingTables = {
  cns5: [
    cns5Row({ gj: '820.0', gjComp: 'AB', gaiaSourceId: '200' }),
    cns5Row({ gj: '1001.0', gjComp: 'C', gaiaSourceId: '1001' }),
    cns5Row({ gj: '1001.0', gjComp: 'A', gaiaSourceId: '1000' }),
    cns5Row({ gj: '5.0', gjComp: null, gaiaSourceId: '5' }),
  ],
  glAliases: new Map([['157.1', ['9140']], ['9140', ['157.1']]]),
  tycToSource: new Map([['1-1-1', '100'], ['2-2-1', '200']]),
  hipToSource: new Map([[10, '100'], [20, '999']]),
  simbadBySourceId,
};
const { cns5ByKey, cns5ByOwnKey } = indexCns5(tables.cns5);

function candidates(over: Partial<BindingCandidates>): BindingCandidates {
  return { tyc: null, hip: null, cns5: null, simbad: null, ...over };
}

describe('indexSimbadSources', () => {
  it('inverts each cross-ID onto its source, and proposes nothing for a contested key', () => {
    expect(simbad.byHip.get(10)).toBe('100');
    expect(simbad.byTyc.get('2-2-1')).toBe('200');
    expect(simbad.byGj.get('820A')).toBe('200');
    expect(simbad.byGj.get('820')).toBeNull();
    expect(simbad.byGj.get('866')).toBe('866');
    expect(simbad.byHip.get(30)).toBeNull();
  });
});

describe('simbadCandidate', () => {
  it('asks hip first, then tyc, then the GJ exact before bare', () => {
    expect(simbadCandidate({ tyc: '2-2-1', hip: '10', gl: '' }, simbad, tables.glAliases)).toBe('100');
    expect(simbadCandidate({ tyc: '2-2-1', hip: '', gl: 'Gl 820B' }, simbad, tables.glAliases)).toBe('200');
    expect(simbadCandidate({ tyc: '', hip: '', gl: 'Gl 820B' }, simbad, tables.glAliases)).toBe('201');
  });

  // The pull kept EZ Aqr under `866 C`; the record's `Gl 866A` reaches the one
  // object on the bare number. 61 Cyg's two objects contest `820`, so a cell
  // naming a letter neither kept reaches neither.
  it('lets a bare number reach an unresolved pair\'s one object, never a resolved pair\'s', () => {
    expect(simbadCandidate({ tyc: '', hip: '', gl: 'Gl 866A' }, simbad, tables.glAliases)).toBe('866');
    expect(simbadCandidate({ tyc: '', hip: '', gl: 'GJ 820C' }, simbad, tables.glAliases)).toBeNull();
  });

  it('answers a contested HIP with nothing rather than falling to the next key', () => {
    expect(simbadCandidate({ tyc: '2-2-1', hip: '30', gl: '' }, simbad, tables.glAliases)).toBeNull();
  });

  it('reaches SIMBAD through a stored GJ renumbering bridge', () => {
    expect(simbadCandidate({ tyc: '', hip: '', gl: 'Gl 157.1' }, simbad, tables.glAliases)).toBe('400');
  });
});

describe('bindingCandidates', () => {
  it('reads all four sources off the row', () => {
    expect(bindingCandidates({ tyc: '2-2-1', hip: '20', gl: 'Gl 820A' }, tables, cns5ByOwnKey, simbad))
      .toEqual({ tyc: '200', hip: '999', cns5: '200', simbad: '200' });
    expect(bindingCandidates({ tyc: '', hip: '', gl: '' }, tables, cns5ByOwnKey, simbad))
      .toEqual({ tyc: null, hip: null, cns5: null, simbad: null });
  });

  // GJ 1001 is the shape: the primary's bare cell, CNS5 listing the L-dwarf
  // companion C first. The audit's fold answers "does CNS5 number this star"
  // and may take any row; a binding takes one component's source and may not.
  it('never folds a bare cell onto a component row\'s source', () => {
    expect(cns5ByKey.get('1001')?.gaiaSourceId).toBe('1001');
    expect(bindingCandidates({ tyc: '', hip: '', gl: 'GJ 1001' }, tables, cns5ByOwnKey, simbad).cns5)
      .toBeNull();
    expect(bindingCandidates({ tyc: '', hip: '', gl: 'GJ 1001A' }, tables, cns5ByOwnKey, simbad).cns5)
      .toBe('1000');
    expect(bindingCandidates({ tyc: '', hip: '', gl: 'Gl 5' }, tables, cns5ByOwnKey, simbad).cns5)
      .toBe('5');
  });
});

describe('rankCandidates', () => {
  it('puts a value two sources agree on ahead of a lone leader, ties in precedence', () => {
    expect(rankCandidates(candidates({ tyc: 'a', hip: 'b', cns5: 'b', simbad: 'c' })))
      .toEqual([{ sourceId: 'b', via: ['hip', 'cns5'] }, { sourceId: 'a', via: ['tyc'] }, { sourceId: 'c', via: ['simbad'] }]);
    expect(rankCandidates(candidates({ simbad: 'c' }))).toEqual([{ sourceId: 'c', via: ['simbad'] }]);
  });
});

describe('bindingClassOf', () => {
  it('names a walk-backed value crosswalk_gated and a SIMBAD-only one simbad_corroborated', () => {
    expect(bindingClassOf(['tyc', 'simbad'])).toBe('crosswalk_gated');
    expect(bindingClassOf(['simbad'])).toBe('simbad_corroborated');
    expect(bindingClassOf([])).toBe('none');
  });
});

const WDS_XIDS = parseSimbadWdsXidsTsv([
  'wds_id\tcomponent\tgaia_source_id\thip',
  '00001+0000\tA\t500\t50',
  '00001+0000\tB\t501\t',
].join('\n'));

describe('deriveBinding', () => {
  const gMag = new Map([['a', 12.0], ['b', 5.05], ['c', 5.1]]);
  const evidence = bindingEvidence(
    gMag, new Map([[50, 5.0]]), WDS_XIDS, NO_PRINTED_V_BELOW_HIP,
    new Set([...gMag.keys(), 'nullg']),
  );

  it('weighs candidates in rank order and falls through on a magnitude rejection', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, () => null);
    const d = deriveBinding(candidates({ tyc: 'a', hip: 'b', simbad: 'c' }), gate);
    expect(d).toMatchObject({ sourceId: 'b', via: ['hip'], binding: 'crosswalk_gated', gateable: true });
    expect(d.rejected).toEqual([{ sourceId: 'a', via: ['tyc'], reason: 'mag' }]);
  });

  it('refuses the sibling component\'s source on the WDS letters and falls through', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, () => null);
    const d = deriveBinding(candidates({ hip: '501', simbad: 'c' }), gate);
    expect(d.sourceId).toBe('c');
    expect(d.binding).toBe('simbad_corroborated');
    expect(d.rejected).toEqual([{ sourceId: '501', via: ['hip'], reason: 'sibling' }]);
  });

  it('derives a refusal where every candidate is rejected, and where there is none', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, () => null);
    expect(deriveBinding(candidates({ tyc: 'a' }), gate))
      .toMatchObject({ sourceId: null, via: [], binding: 'none' });
    expect(deriveBinding(candidates({}), gate)).toMatchObject({ sourceId: null, ranked: [], rejected: [] });
  });

  // A missing G is a pass, so the two causes are counted rather than refused:
  // no pulled row is the request under-covering the derivation, a pulled row
  // with no G is Gaia publishing none.
  it('counts candidates it weighed without a G, by cause, and passes them', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, () => null);
    expect(deriveBinding(candidates({ tyc: 'unpulled' }), gate))
      .toMatchObject({ sourceId: 'unpulled', weighedNoGMag: 1, weighedNullGMag: 0 });
    expect(deriveBinding(candidates({ tyc: 'nullg' }), gate))
      .toMatchObject({ sourceId: 'nullg', weighedNoGMag: 0, weighedNullGMag: 1 });
  });

  // Gl 864 is the shape: the winner's rival was the TYC walk's neighbour at
  // G 13.90 against V 9.98, which the magnitude gate settles by itself. Weigh
  // the losers as well as the candidates ahead of the winner, or the rival
  // reads as a passing runner-up and the row queues a `contested` verdict on a
  // verdict never taken.
  it('weighs the candidates behind the winner too, so a rival it refuses is not a runner-up', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, () => null);
    const d = deriveBinding(candidates({ hip: 'b', simbad: 'a' }), gate);
    expect(d.sourceId).toBe('b');
    expect(d.rejected).toEqual([{ sourceId: 'a', via: ['simbad'], reason: 'mag' }]);
  });

  it('cannot weigh a row with no printed V, and says so', () => {
    const gate = rowGateEvidence({ tyc: '1-1-1', hip: '', gl: '' }, evidence, () => null);
    expect(gate).toMatchObject({ vMag: null, vVia: null });
    expect(deriveBinding(candidates({ tyc: 'a' }), gate))
      .toMatchObject({ sourceId: 'a', gateable: false, weighedNoGMag: 0 });
  });

  // The printed tiers in the V cascade's order: Hipparcos on the row's HIP,
  // else Tycho-2 on its TYC — so an HD-only Tycho star's candidates are weighed
  // too, which is where a best-neighbour walk landing on a faint neighbour has
  // no HIP to be caught by.
  it('weighs against the lower printed tiers where the row carries no Hipparcos V', () => {
    const below = (row: { tyc: string; gl: string }) => (row.tyc === '1-1-1'
      ? { vMag: 5.0, vVia: 'tycho2' as const }
      : row.gl === 'GJ 4285' ? { vMag: 5.0, vVia: 'gliese' as const } : null);
    const gate = rowGateEvidence({ tyc: '1-1-1', hip: '', gl: '' }, evidence, below);
    expect(gate).toMatchObject({ vMag: 5.0, vVia: 'tycho2' });
    expect(deriveBinding(candidates({ tyc: 'a', simbad: 'c' }), gate))
      .toMatchObject({ sourceId: 'c', gateable: true });
    expect(rowGateEvidence({ tyc: '', hip: '', gl: 'GJ 4285' }, evidence, below))
      .toMatchObject({ vMag: 5.0, vVia: 'gliese' });
    expect(rowGateEvidence({ tyc: '1-1-1', hip: '50', gl: '' }, evidence, below))
      .toMatchObject({ vMag: 5.0, vVia: 'hip' });
  });
});

describe('derivationCandidateSourceIds', () => {
  it('collects every source any row could be bound to, gateable or not', () => {
    const rows = [
      { tyc: '1-1-1', hip: '10', gl: '' },
      { tyc: '', hip: '20', gl: 'Gl 820B' },
    ];
    expect([...derivationCandidateSourceIds(rows, tables, cns5ByOwnKey, simbad)].sort())
      .toEqual(['100', '200', '201', '999']);
  });
});
