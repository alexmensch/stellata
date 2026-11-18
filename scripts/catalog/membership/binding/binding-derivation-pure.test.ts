import { describe, expect, it } from 'vitest';

import { columnTable } from '../../../util/tsv/table-pure';

import { bindingEvidence, parseSimbadWdsXidsTsv } from './binding-gate-pure';
import { cns5Row } from '../../classic-ids/cns5-fixture';
import { indexCns5, type BindingTables } from '../../spine/primaries-audit-pure';
import type { SimbadXids } from '../../spectral/spectral-resolve';
import {
  bindingCandidates,
  bindingClassOf,
  derivationCandidateSourceIds,
  deriveBinding,
  indexSimbadSources,
  isUnconfirmed,
  rankCandidates,
  rowGateEvidence,
  simbadCandidate,
  type BindingCandidates,
  type PositionEvidence,
} from './binding-derivation-pure';
import { printedVOf } from '../../photometry/photometry-fixture';

const FROM = { file: 'fixture.tsv', hint: 'h' };
const NO_POSITIONS: PositionEvidence = { hipparcos: () => null, gaia: () => null, keptNearHip: new Map() };

const simbadBySourceId = new Map<string, SimbadXids>([
  ['100', { oid: 0, hip: 10, tyc: '1-1-1', gj: null }],
  ['200', { oid: 0, hip: null, tyc: '2-2-1', gj: '820 A' }],
  ['201', { oid: 0, hip: null, tyc: null, gj: '820 B' }],
  ['300', { oid: 0, hip: 30, tyc: null, gj: null }],
  ['301', { oid: 0, hip: 30, tyc: null, gj: null }],
  ['400', { oid: 0, hip: null, tyc: null, gj: '9140' }],
  ['866', { oid: 0, hip: null, tyc: null, gj: '866 C' }],
  ['575', { oid: 0, hip: null, tyc: '3484-1580-2', gj: '575 B' }],
]);
const simbadSourceless: SimbadXids[] = [{ oid: 0, hip: 73695, tyc: null, gj: '575' }];
const simbad = indexSimbadSources(simbadBySourceId, simbadSourceless);

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
  simbadSourceless,
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

  // 44 Boo: the system object `* i Boo` carries HIP 73695 and `GJ 575` with no
  // Gaia id, and `* i Boo B` carries `575 B` with one.
  it('counts an object with no Gaia id as a claimant, so the bare number reaches neither of 44 Boo\'s', () => {
    expect(simbad.byGj.get('575')).toBeNull();
    expect(simbadCandidate({ tyc: '3484-1580-1', hip: '73695', gl: 'Gl 575A' }, simbad, tables.glAliases)).toBeNull();
    expect(simbadCandidate({ tyc: '', hip: '', gl: 'Gl 575B' }, simbad, tables.glAliases)).toBe('575');
  });

  it('lets a key only an object with no Gaia id claims fall through to the next', () => {
    expect(simbad.byHip.has(73695)).toBe(false);
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

const WDS_XIDS = parseSimbadWdsXidsTsv(columnTable(FROM, [
  'wds_id\tcomponent\tgaia_source_id\thip',
  '00001+0000\tA\t500\t50',
  '00001+0000\tB\t501\t',
].join('\n')));

describe('deriveBinding', () => {
  const gMag = new Map([['a', 12.0], ['b', 5.05], ['c', 5.1]]);
  const evidence = bindingEvidence(
    gMag,
    WDS_XIDS,
    printedVOf({ hip: new Map([[50, 5.0]]) }),
    new Set([...gMag.keys(), 'nullg']),
  );

  it('weighs candidates in rank order and falls through on a magnitude rejection', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, simbad, NO_POSITIONS);
    const d = deriveBinding(candidates({ tyc: 'a', hip: 'b', simbad: 'c' }), gate);
    expect(d).toMatchObject({ sourceId: 'b', via: ['hip'], binding: 'crosswalk_gated', gateable: true });
    expect(d.rejected).toEqual([{ sourceId: 'a', via: ['tyc'], reason: 'mag' }]);
  });

  it('refuses the sibling component\'s source on the WDS letters and falls through', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, simbad, NO_POSITIONS);
    const d = deriveBinding(candidates({ hip: '501', simbad: 'c' }), gate);
    expect(d.sourceId).toBe('c');
    expect(d.binding).toBe('simbad_corroborated');
    expect(d.rejected).toEqual([{ sourceId: '501', via: ['hip'], reason: 'sibling' }]);
  });

  // 501 is outside the pull as well as sibling-refused: the zero-pinned
  // coverage alarm still has to see it.
  it('counts an unpulled candidate in the coverage alarm even when the sibling arm refuses it', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, simbad, NO_POSITIONS);
    const d = deriveBinding(candidates({ hip: '501' }), gate);
    expect(d.rejected.map((r) => r.reason)).toEqual(['sibling']);
    expect(d.unweighedNoPulledRow.map((c) => c.sourceId)).toEqual(['501']);
  });

  it('derives a refusal where every candidate is rejected, and where there is none', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, simbad, NO_POSITIONS);
    expect(deriveBinding(candidates({ tyc: 'a' }), gate))
      .toMatchObject({ sourceId: null, via: [], binding: 'none' });
    expect(deriveBinding(candidates({}), gate)).toMatchObject({ sourceId: null, ranked: [], rejected: [] });
  });

  // A missing G is a pass, so the two causes are counted rather than refused:
  // no pulled row is the request under-covering the derivation, a pulled row
  // with no G is Gaia publishing none.
  it('counts candidates it weighed without a G, by cause, and passes them', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, simbad, NO_POSITIONS);
    expect(deriveBinding(candidates({ tyc: 'unpulled' }), gate))
      .toMatchObject({ sourceId: 'unpulled', unweighedNoPulledRow: [{ sourceId: 'unpulled' }], weighedNullGMag: [] });
    expect(deriveBinding(candidates({ tyc: 'nullg' }), gate))
      .toMatchObject({ sourceId: 'nullg', unweighedNoPulledRow: [], weighedNullGMag: [{ sourceId: 'nullg' }] });
  });

  // Gl 864 is the shape: the winner's rival was the TYC walk's neighbour at
  // G 13.90 against V 9.98, which the magnitude gate settles by itself. Weigh
  // the losers as well as the candidates ahead of the winner, or the rival
  // reads as a passing runner-up and the row queues a `contested` verdict on a
  // verdict never taken.
  it('weighs the candidates behind the winner too, so a rival it refuses is not a runner-up', () => {
    const gate = rowGateEvidence({ tyc: '', hip: '50', gl: '' }, evidence, simbad, NO_POSITIONS);
    const d = deriveBinding(candidates({ hip: 'b', simbad: 'a' }), gate);
    expect(d.sourceId).toBe('b');
    expect(d.rejected).toEqual([{ sourceId: 'a', via: ['simbad'], reason: 'mag' }]);
  });

  describe('the component witness', () => {
    // HIP 60 sits on both letters, so the gate reads a HIP 60 row as the system.
    const xids = parseSimbadWdsXidsTsv(columnTable(FROM, [
      'wds_id\tcomponent\tgaia_source_id\thip',
      '00002+0000\tA\t600\t60',
      '00002+0000\tB\t601\t60',
    ].join('\n')));
    const witnessed = bindingEvidence(
      new Map([['600', 5.0], ['601', 5.2]]),
      xids,
      printedVOf({ hip: new Map([[60, 5.0]]) }),
    );
    const witnessIndex = indexSimbadSources(new Map([
      ['601', { oid: 0, hip: null, tyc: '6-6-1', gj: null }],
      ['700', { oid: 0, hip: null, tyc: '7-7-1', gj: null }],
      ['701', { oid: 0, hip: null, tyc: '8-8-1', gj: null }],
      ['702', { oid: 0, hip: null, tyc: '8-8-1', gj: null }],
    ]), []);
    const gate = rowGateEvidence(
      { tyc: '6-6-1', hip: '60', gl: '' }, witnessed, witnessIndex, NO_POSITIONS,
    );

    it('rescues a row whose only candidate SIMBAD indexes its own TYC under (53 Aqr B)', () => {
      const d = deriveBinding(candidates({ simbad: '601' }), gate);
      expect(d).toMatchObject({ sourceId: '601', rejected: [] });
    });

    it('never outranks a candidate that passes on its own (HD 17743)', () => {
      const d = deriveBinding(candidates({ tyc: '601', hip: '600' }), gate);
      expect(d.sourceId).toBe('600');
      expect(d.rejected).toEqual([{ sourceId: '601', via: ['tyc'], reason: 'sibling' }]);
    });

    it('does not rescue on a TYC SIMBAD indexes under another source', () => {
      const other = rowGateEvidence(
        { tyc: '7-7-1', hip: '60', gl: '' }, witnessed, witnessIndex, NO_POSITIONS,
      );
      expect(deriveBinding(candidates({ simbad: '601' }), other).sourceId).toBeNull();
    });

    it('takes no witness from a TYC two SIMBAD objects claim', () => {
      const contested = rowGateEvidence(
        { tyc: '8-8-1', hip: '60', gl: '' }, witnessed, witnessIndex, NO_POSITIONS,
      );
      expect(contested.tycWitness).toBeNull();
    });
  });

  // θ¹ Ori A's figures: README.md#identity-outranks-a-blended-magnitude.
  describe('the identity witness', () => {
    const blend = bindingEvidence(new Map([['900', 6.63]]), null, printedVOf({ hip: new Map([[90, 4.98]]) }));
    const index = indexSimbadSources(new Map([['900', { oid: 0, hip: 90, tyc: null, gj: null }]]), []);
    const hip90 = { raDeg: 83.81588707, decDeg: -5.38727971 };
    const at = (raDeg: number, decDeg: number): PositionEvidence => ({
      hipparcos: (hip) => (hip === 90 ? hip90 : null),
      gaia: (id) => (id === '900' ? { raDeg, decDeg, pmRaMasyr: 1.3552, pmDecMasyr: 0.2501, refEpoch: 2016 } : null),
      keptNearHip: new Map(),
    });
    const derive = (positions: PositionEvidence) => deriveBinding(
      candidates({ simbad: '900' }), rowGateEvidence({ tyc: '', hip: '90', gl: '' }, blend, index, positions),
    );

    it('binds a magnitude-refused source SIMBAD and the HIP\'s position both name', () => {
      const d = derive(at(83.815945223, -5.387314083));
      expect(d).toMatchObject({ sourceId: '900', rescue: 'identity', rejected: [] });
      expect(isUnconfirmed(d)).toBe(false);
    });

    it('queues it where the position sits past the tolerance', () => {
      const d = derive(at(83.8165, -5.3873));
      expect(isUnconfirmed(d)).toBe(true);
      expect(d.identity?.sourceId).toBe('900');
      expect(d.identity?.separationArcsec).toBeGreaterThan(1);
    });

    it('queues it where either position is missing', () => {
      const d = derive(NO_POSITIONS);
      expect(d).toMatchObject({ sourceId: null, rescue: null, identity: { sourceId: '900', separationArcsec: null } });
      expect(isUnconfirmed(d)).toBe(true);
    });

    it('never outranks a candidate that passes on its own', () => {
      const gate = rowGateEvidence({ tyc: '', hip: '90', gl: '' }, blend, index, at(83.815945223, -5.387314083));
      const d = deriveBinding(candidates({ tyc: 'passes', simbad: '900' }), gate);
      expect(d).toMatchObject({ sourceId: 'passes', rescue: null, identity: null });
    });

    it('never outranks a sibling-letter refusal, which no blended magnitude explains', () => {
      const xids = parseSimbadWdsXidsTsv(columnTable(FROM, [
        'wds_id\tcomponent\tgaia_source_id\thip',
        '00009+0000\tA\t\t90',
        '00009+0000\tB\t900\t',
      ].join('\n')));
      const sibling = bindingEvidence(new Map([['900', 5.2]]), xids, printedVOf({ hip: new Map([[90, 4.98]]) }));
      const gate = rowGateEvidence({ tyc: '', hip: '90', gl: '' }, sibling, index, at(83.815945223, -5.387314083));
      const d = deriveBinding(candidates({ simbad: '900' }), gate);
      expect(d).toMatchObject({ sourceId: null, rescue: null, identity: null });
      expect(d.rejected).toEqual([{ sourceId: '900', via: ['simbad'], reason: 'sibling' }]);
    });

    it('has nothing to say where SIMBAD files the HIP under no source', () => {
      expect(rowGateEvidence({ tyc: '', hip: '91', gl: '' }, blend, index, at(0, 0)).identity).toBeNull();
    });
  });

  it('cannot weigh a row with no printed V, and says so', () => {
    const gate = rowGateEvidence({ tyc: '1-1-1', hip: '', gl: '' }, evidence, simbad, NO_POSITIONS);
    expect(gate.printedV).toBeNull();
    expect(deriveBinding(candidates({ tyc: 'a' }), gate))
      .toMatchObject({ sourceId: 'a', gateable: false, unweighedNoPulledRow: [] });
  });

  // The printed tiers in the V cascade's order: Hipparcos on the row's HIP,
  // else Tycho-2 on its TYC — so an HD-only Tycho star's candidates are weighed
  // too, which is where a best-neighbour walk landing on a faint neighbour has
  // no HIP to be caught by.
  it('weighs against the lower printed tiers where the row carries no Hipparcos V', () => {
    const lower = bindingEvidence(gMag, WDS_XIDS, printedVOf({
      hip: new Map([[50, 5.0]]), tycho2: { '1-1-1': 5.0 }, gliese: { 'GJ 4285': 5.0 },
    }));
    const gate = rowGateEvidence({ tyc: '1-1-1', hip: '', gl: '' }, lower, simbad, NO_POSITIONS);
    expect(gate.printedV).toMatchObject({ vMag: 5.0, vVia: 'tycho2' });
    expect(deriveBinding(candidates({ tyc: 'a', simbad: 'c' }), gate))
      .toMatchObject({ sourceId: 'c', gateable: true });
    expect(rowGateEvidence({ tyc: '', hip: '', gl: 'GJ 4285' }, lower, simbad, NO_POSITIONS).printedV)
      .toMatchObject({ vMag: 5.0, vVia: 'gliese' });
    expect(rowGateEvidence({ tyc: '1-1-1', hip: '50', gl: '' }, lower, simbad, NO_POSITIONS).printedV)
      .toMatchObject({ vMag: 5.0, vVia: 'printed_hip' });
  });
});

// f Pup's figures: README.md#the-position-witness.
describe('the position witness', () => {
  const fPup = { sourceId: '5588312348336552576', gMag: 4.411, separationArcsec: 0.221 };
  const near = (hip: number, sources: { sourceId: string; gMag: number; separationArcsec: number }[]): PositionEvidence =>
    ({ ...NO_POSITIONS, keptNearHip: new Map([[hip, sources]]) });
  const evidence = bindingEvidence(
    new Map([['5588312348336552576', 4.411], ['far', 9.0], ['500', 9.6], ['501', 10.1], ['other', 4.5]]),
    WDS_XIDS, printedVOf({ hip: new Map([[37096, 4.53], [50, 9.16]]) }),
  );
  const derive = (c: Partial<BindingCandidates>, hip: number, positions: PositionEvidence) => deriveBinding(
    candidates(c), rowGateEvidence({ tyc: '', hip: String(hip), gl: '' }, evidence, simbad, positions),
  );

  it('binds f Pup (HIP 37096), which no candidate reaches, to the floor source its carried position lands on', () => {
    const d = derive({}, 37096, near(37096, [fPup]));
    expect(d).toMatchObject({ sourceId: fPup.sourceId, via: [], binding: 'position_witnessed', rescue: 'position' });
    expect(d.position).toEqual({ witness: { ...fPup, others: 0, vMag: 4.53 }, disputedBy: null });
  });

  it('takes the brightest of several, ties on the source id', () => {
    const pair = [{ sourceId: '9', gMag: 10.08, separationArcsec: 0.64 }, { sourceId: '8', gMag: 9.53, separationArcsec: 0.12 }];
    expect(derive({}, 1248, near(1248, pair)).position?.witness).toMatchObject({ sourceId: '8', others: 1 });
    const tied = [{ sourceId: '20', gMag: 9.5, separationArcsec: 0.1 }, { sourceId: '3', gMag: 9.5, separationArcsec: 0.9 }];
    expect(derive({}, 1248, near(1248, tied)).sourceId).toBe('3');
  });

  it('takes a refused candidate off the refusals when it is the witness\'s source', () => {
    const d = derive({ hip: 'far' }, 37096, near(37096, [{ sourceId: 'far', gMag: 9.0, separationArcsec: 0.3 }]));
    expect(d).toMatchObject({ sourceId: 'far', via: ['hip'], binding: 'position_witnessed', rejected: [] });
    expect(d.position?.disputedBy).toBeNull();
  });

  it('records the source Gaia\'s HIP cross-match names instead, so the row queues', () => {
    expect(derive({ hip: 'far' }, 37096, near(37096, [fPup])).position?.disputedBy).toBe('far');
  });

  it('never takes a source SIMBAD letters as another component than the HIP\'s', () => {
    const d = derive({}, 50, near(50, [{ sourceId: '501', gMag: 10.1, separationArcsec: 0.3 }]));
    expect(d).toMatchObject({ sourceId: null, rescue: null, position: null });
    expect(derive({}, 50, near(50, [
      { sourceId: '501', gMag: 10.1, separationArcsec: 0.3 }, { sourceId: '500', gMag: 9.6, separationArcsec: 0.1 },
    ])).position?.witness).toMatchObject({ sourceId: '500', others: 0 });
  });

  it('leaves a row SIMBAD names a refused source for to the identity witness, confirmed or not', () => {
    const index = indexSimbadSources(new Map([['far', { oid: 0, hip: 37096, tyc: null, gj: null }]]), []);
    const unconfirmed: PositionEvidence = { ...near(37096, [fPup]), hipparcos: () => ({ raDeg: 0, decDeg: 0 }),
      gaia: () => ({ raDeg: 10, decDeg: 10, pmRaMasyr: 0, pmDecMasyr: 0, refEpoch: 2016 }) };
    const d = deriveBinding(candidates({ simbad: 'far' }),
      rowGateEvidence({ tyc: '', hip: '37096', gl: '' }, evidence, index, unconfirmed));
    expect(d).toMatchObject({ sourceId: null, position: null });
    expect(isUnconfirmed(d)).toBe(true);
  });

  it('never outranks a candidate that passes on its own', () => {
    expect(derive({ hip: 'other' }, 37096, near(37096, [fPup]))).toMatchObject({ sourceId: 'other', rescue: null, position: null });
  });
});

describe('derivationCandidateSourceIds', () => {
  it('collects every source any row could be bound to, gateable or not', () => {
    const rows = [
      { tyc: '1-1-1', hip: '10', gl: '' },
      { tyc: '', hip: '20', gl: 'Gl 820B' },
    ];
    expect([...derivationCandidateSourceIds(rows, tables, cns5ByOwnKey, simbad, new Map())].sort())
      .toEqual(['100', '200', '201', '999']);
  });

  it('adds every floor source near a row\'s HIP, whichever the position witness would take', () => {
    const near = new Map([[20, [{ sourceId: '7', gMag: 9, separationArcsec: 0.1 }, { sourceId: '8', gMag: 9.5, separationArcsec: 0.6 }]]]);
    expect([...derivationCandidateSourceIds([{ tyc: '', hip: '20', gl: '' }], tables, cns5ByOwnKey, simbad, near)].sort())
      .toEqual(['7', '8', '999']);
  });
});
