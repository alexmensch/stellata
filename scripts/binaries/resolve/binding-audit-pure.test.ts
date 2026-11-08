import { describe, expect, it } from 'vitest';

import { componentKey } from '../component-tokens-pure';
import type { SimbadWdsXid } from '../load/simbad-pure';
import {
  auditBindingIntegrity, bfsOffset, bindingAuditSourceIds, bindingIntegrityCounts, enforceBindingVerdicts,
  type BindingCandidate, type BindingVerdict, type Edge,
} from './binding-audit-pure';
import { BI_WDS, astrometryMap, biAstro, biSystem, indices, xid, type BiRow } from './resolve-fixture';

describe('bfsOffset', () => {
  const edge = (eastArcsec: number, epoch: number): Edge => ({ eastArcsec, northArcsec: 0, epoch });
  it('composes a multi-hop chain and carries the epoch of the edge reaching the goal', () => {
    const adj = new Map([
      ['A', new Map([['B', edge(5, 2016)]])],
      ['B', new Map([['A', edge(-5, 2016)], ['C', edge(5, 2015)]])],
      ['C', new Map([['B', edge(-5, 2015)]])],
    ]);
    expect(bfsOffset(adj, 'A', 'C')).toEqual({ eastArcsec: 10, northArcsec: 0, epoch: 2015 });
    expect(bfsOffset(new Map([['A', new Map()]]), 'A', 'Z')).toBeNull();
  });
});

const SA = '100';
const SX = '200';
const SC = '300';

function audit(rows: readonly BiRow[], astro: ReturnType<typeof biAstro>[], opts: {
  hipToGaia?: Map<number, string>; xids?: ReadonlyMap<ReturnType<typeof componentKey>, SimbadWdsXid>;
} = {}) {
  const { pairs, components } = biSystem(rows);
  const idx = indices({ srcToAstrometry: astrometryMap(astro), hipToGaia: opts.hipToGaia });
  const verdicts = auditBindingIntegrity(pairs, components, idx, opts.xids ?? new Map());
  return { verdicts, pairs, components, idx };
}

const ofShape = (verdicts: readonly BindingVerdict[], shape: BindingVerdict['shape']) => verdicts.filter((v) => v.shape === shape);
const sortedUnbind = (v: BindingVerdict) => v.unbind.map((u) => `${u.token}:${u.sourceId}`).sort();
const xids = (a: SimbadWdsXid, b: SimbadWdsXid) =>
  new Map([[componentKey(BI_WDS, 'A'), a], [componentKey(BI_WDS, 'B'), b]]);

describe('auditBindingIntegrity', () => {
  it('keeps the secondary a source sits on and unbinds the other', () => {
    const { verdicts } = audit(
      [['AB', 3.0, 0.0, [SA, null], [SX, null]], ['AC', 10.0, 0.0, [SA, null], [SX, null]]],
      [biAstro(SA, 0, 0), biAstro(SX, 0, 3)],
    );
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('geometric');
    expect(v[0].winner?.label).toBe('B');
    expect(v[0].unbind).toEqual([{ token: 'C', sourceId: SX }]);
  });

  it('rebinds a letter carrying two sources to the one at its measured position', () => {
    const SB = '200';
    const { verdicts } = audit(
      [
        ['AB', 0.9, 0.0, [SA, null], [SB, null]],
        ['AC', 5.0, 0.0, [SA, null], ['300', null]],
        ['BC', 4.1, 0.0, [SA, null], ['300', null]],
      ],
      [biAstro(SA, 0, 0), biAstro(SB, 0, 0.9), biAstro('300', 0, 5)],
    );
    const v = ofShape(verdicts, 'letter_sources');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('geometric');
    expect(v[0].winner?.sourceId).toBe(SB);
    expect(v[0].rebind).toEqual({ letter: 'B', sourceId: SB });
  });

  it('finds no conflict in a source bound along one ancestry', () => {
    const { verdicts } = audit(
      [
        ['AB', 3.0, 0.0, [SX, null], ['401', null]],
        ['Aa,Ab', 0.5, 0.0, [SX, null], ['402', null]],
        ['Aa1,Aa2', 0.2, 0.0, [SX, null], ['403', null]],
      ],
      [biAstro(SX, 0, 0), biAstro('401', 0, 3), biAstro('402', 0, 0.5), biAstro('403', 0, 0.2)],
    );
    expect(ofShape(verdicts, 'source_letters')).toEqual([]);
  });

  it('finds no conflict in a source bound to a compound and a letter it contains', () => {
    const { verdicts } = audit(
      [['AB,C', 3.0, 0.0, [SX, null], ['401', null]], ['A,D', 3.0, 90.0, [SX, null], ['402', null]]],
      [biAstro(SX, 0, 0), biAstro('401', 0, 3), biAstro('402', 3, 0)],
    );
    expect(ofShape(verdicts, 'source_letters')).toEqual([]);
  });

  it('exempts the two sides of a ρ = 0 blend', () => {
    const { verdicts } = audit([['AB', 0.0, 0.0, [SX, null], [SX, null]]], [biAstro(SX, 0, 0)]);
    expect(verdicts).toEqual([]);
  });

  it('calls two letters at a measured separation on one source a conflict', () => {
    const { verdicts } = audit(
      [['AB', 1.0, 0.0, [SX, null], [SX, null]], ['AC', 10.0, 0.0, [SX, null], [SC, null]]],
      [biAstro(SX, 0, 0), biAstro(SC, 0, 10)],
    );
    expect(ofShape(verdicts, 'source_letters')).toHaveLength(1);
  });

  it('unbinds every side when no candidate is decisive', () => {
    const { verdicts } = audit(
      [['AB', 3.0, 0.0, [SA, null], [SX, null]], ['AC', 5.0, 0.0, [SA, null], [SX, null]]],
      [biAstro(SA, 0, 0), biAstro(SX, 0, 4)],
    );
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('unbound_ambiguous');
    expect(sortedUnbind(v[0])).toEqual([`B:${SX}`, `C:${SX}`]);
  });

  const blendRows: BiRow[] = [['AB', 5.0, 0.0, [SX, null], [SX, null]], ['AC', 10.0, 0.0, [SX, null], [SC, null]]];

  it('skips a measured blend whose source sits between the components (Castor)', () => {
    const { verdicts } = audit(blendRows, [biAstro(SX, 0, -6.5), biAstro(SC, 0, 0)]);
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('skipped_photocentre_blend');
    expect(v[0].unbind).toEqual([]);
  });

  it('unbinds a measured blend whose source sits on one component', () => {
    const { verdicts } = audit(blendRows, [biAstro(SX, 0, -9.7), biAstro(SC, 0, 0)]);
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('geometric');
    expect(v[0].winner?.label).toBe('A');
    expect(v[0].unbind).toEqual([{ token: 'B', sourceId: SX }]);
  });

  it('skips, never unbinds, an ambiguous blend', () => {
    const { verdicts } = audit(blendRows, [biAstro(SX, 0, -7.5), biAstro(SC, 0, 0)]);
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('skipped_photocentre_blend');
    expect(v[0].unbind).toEqual([]);
  });

  const refutable: BiRow[] = [['AB', 5.0, 0.0, [SX, null], [SX, null]], ['AC', 10.0, 0.0, [SA, null], [SC, null]]];
  const refutableAstro = () => [biAstro(SA, 0, 0), biAstro(SX, 0, -6.5), biAstro(SC, 0, 0)];

  it('refutes a blend by SIMBAD identity and rebinds the loser to its own source (36 Oph)', () => {
    const x = xids(xid(BI_WDS, 'A', SA), xid(BI_WDS, 'B', SX));
    const { verdicts, pairs, components, idx } = audit(refutable, refutableAstro(), { xids: x });
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('identity_refuted');
    expect(v[0].winner?.label).toBe('B');
    expect(v[0].rebind).toEqual({ letter: 'A', sourceId: SA });
    expect(ofShape(verdicts, 'letter_sources')).toEqual([]);
    const after = enforceBindingVerdicts(pairs, components, verdicts, idx);
    expect(after.find((c) => c.component === 'A' && c.isPrimary)?.gaiaSourceId).toBe(SA);
    expect(after.find((c) => c.component === 'B' && !c.isPrimary)?.gaiaSourceId).toBe(SX);
  });

  it('refutes with a hierarchy cluster as the owner (μ Dra)', () => {
    const x = xids(xid(BI_WDS, 'A', SA), xid(BI_WDS, 'B', SX));
    const { verdicts, pairs, components, idx } = audit(
      [...refutable, ['Ba,Bb', 0.0, 0.0, [SX, null], [SX, null]]], refutableAstro(), { xids: x },
    );
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('identity_refuted');
    expect(v[0].winner?.label).toBe('B');
    expect([...v[0].winner!.tokens].sort()).toEqual(['B', 'Ba', 'Bb']);
    expect(v[0].rebind?.letter).toBe('A');
    const after = enforceBindingVerdicts(pairs, components, verdicts, idx);
    expect(after.find((c) => c.component === 'A' && c.isPrimary)?.gaiaSourceId).toBe(SA);
    expect(after.find((c) => c.component === 'Ba' && c.isPrimary)?.gaiaSourceId).toBe(SX);
  });

  it('keeps the blend skip when one side has no identity of its own', () => {
    const x = xids(xid(BI_WDS, 'A', null), xid(BI_WDS, 'B', SX));
    const { verdicts } = audit(blendRows, [biAstro(SX, 0, -6.5), biAstro(SC, 0, 0)], { xids: x });
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('skipped_photocentre_blend');
  });

  it('keeps the blend skip when neither side owns the source', () => {
    const x = xids(xid(BI_WDS, 'A', SA), xid(BI_WDS, 'B', '150'));
    const { verdicts } = audit(blendRows, [biAstro(SX, 0, -6.5), biAstro(SC, 0, 0)], { xids: x });
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('skipped_photocentre_blend');
  });

  it('refutes through a SIMBAD HIP the cross-walk turns into a source', () => {
    const x = xids(xid(BI_WDS, 'A', null, 77), xid(BI_WDS, 'B', SX));
    const { verdicts } = audit(refutable, refutableAstro(), { xids: x, hipToGaia: new Map([[77, SA]]) });
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('identity_refuted');
    expect(v[0].rebind?.sourceId).toBe(SA);
  });

  it('holds a wide pair to the flat floor', () => {
    const { verdicts } = audit(
      [['AB', 60.0, 0.0, [SA, null], [SX, null]], ['AC', 80.0, 0.0, [SA, null], [SX, null]]],
      [biAstro(SA, 0, 0), biAstro(SX, 0, 62.5)],
    );
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('unbound_ambiguous');
  });

  it('elects the one unreachable home when geometry refutes every reachable one', () => {
    const { verdicts } = audit(
      [
        ['AB', 0.0, 0.0, [SX, null], [SX, null]],
        ['CF', 0.1, 0.0, [SC, null], [SX, null]],
        ['CG', 5.0, 90.0, [SC, null], [SX, null]],
      ],
      [biAstro(SX, 0, 20), biAstro(SC, 0, 0)],
    );
    const v = ofShape(verdicts, 'source_letters');
    expect(v).toHaveLength(1);
    expect(v[0].verdict).toBe('geometric');
    expect(new Set(v[0].winner!.tokens)).toEqual(new Set(['A', 'B']));
    expect(sortedUnbind(v[0])).toEqual([`F:${SX}`, `G:${SX}`]);
  });

  it('skips a system with no uncontested astrometric anchor', () => {
    const { verdicts } = audit(
      [['AB', 3.0, 0.0, [SX, null], [SX, null]], ['CD', 3.0, 0.0, [SX, null], [SX, null]]],
      [biAstro(SX, 0, 0)],
    );
    expect(verdicts.length).toBeGreaterThan(0);
    expect(verdicts.every((v) => v.verdict === 'skipped_no_reference')).toBe(true);
  });

  it('leaves its input as it was', () => {
    const { pairs, components } = biSystem([['AB', 3.0, 0.0, [SA, null], [SX, null]], ['AC', 10.0, 0.0, [SA, null], [SX, null]]]);
    const before = components.map((c) => [c.gaiaSourceId, c.hip, c.resolveVia]);
    const idx = indices({ srcToAstrometry: astrometryMap([biAstro(SA, 0, 0), biAstro(SX, 0, 3)]) });
    expect(auditBindingIntegrity(pairs, components, idx, new Map())).toHaveLength(1);
    expect(components.map((c) => [c.gaiaSourceId, c.hip, c.resolveVia])).toEqual(before);
  });
});

describe('enforceBindingVerdicts', () => {
  const rows = (cHip: number | null, bHip: number | null): BiRow[] => [
    ['AB', 3.0, 0.0, [SA, null], [SX, bHip]], ['AC', 10.0, 0.0, [SA, null], [SX, cHip]],
  ];

  it('clears the loser\'s gaia, and its HIP when that cross-walks to the contested source', () => {
    const { verdicts, pairs, components, idx } = audit(
      rows(55, 55), [biAstro(SA, 0, 0), biAstro(SX, 0, 3)], { hipToGaia: new Map([[55, SX]]) },
    );
    const after = enforceBindingVerdicts(pairs, components, verdicts, idx);
    expect(after.find((c) => c.component === 'C')).toMatchObject({ gaiaSourceId: null, hip: null, resolveVia: 'unresolved' });
    expect(after.find((c) => c.component === 'B')?.gaiaSourceId).toBe(SX);
  });

  it('keeps a loser\'s independently distinct HIP for Stage 3', () => {
    const { verdicts, pairs, components, idx } = audit(rows(99, null), [biAstro(SA, 0, 0), biAstro(SX, 0, 3)]);
    const after = enforceBindingVerdicts(pairs, components, verdicts, idx);
    expect(after.find((c) => c.component === 'C')).toMatchObject({ gaiaSourceId: null, hip: 99 });
  });
});

describe('bindingIntegrityCounts', () => {
  const v = (shape: BindingVerdict['shape'], verdict: BindingVerdict['verdict']): BindingVerdict => ({
    wdsId: 'w', shape, verdict, contested: 'c', reference: null, winner: null, candidates: [], unbind: [], rebind: null,
  });

  it('counts each shape and each outcome', () => {
    const counts = bindingIntegrityCounts([
      v('source_letters', 'geometric'), v('source_letters', 'unbound_ambiguous'),
      v('letter_sources', 'skipped_no_reference'), v('source_letters', 'skipped_photocentre_blend'),
    ]);
    expect(counts).toEqual({
      binding_conflicts_source_letters: 3,
      binding_conflicts_letter_sources: 1,
      arbitrated_geometric: 1,
      arbitrated_identity_refuted: 0,
      arbitrated_unbound_ambiguous: 1,
      arbitration_skipped_no_reference: 1,
      arbitration_skipped_photocentre_blend: 1,
    });
  });
});

describe('bindingAuditSourceIds', () => {
  const cand = (src: string): BindingCandidate => ({ label: src, tokens: ['A'], sourceId: src, errArcsec: Infinity, predictedSepArcsec: 0 });

  it('covers every candidate, kept or unbound', () => {
    const verdicts: BindingVerdict[] = [
      {
        wdsId: 'X', shape: 'letter_sources', verdict: 'unbound_ambiguous', contested: 'A', reference: null, winner: null,
        candidates: [cand('444'), cand('555')],
        unbind: [{ token: 'A', sourceId: '444' }, { token: 'A', sourceId: '555' }], rebind: null,
      },
      {
        wdsId: 'Y', shape: 'source_letters', verdict: 'geometric', contested: '666', reference: { token: 'A', sourceId: '777' },
        winner: cand('666'), candidates: [cand('666')], unbind: [], rebind: null,
      },
    ];
    expect(bindingAuditSourceIds(verdicts)).toEqual(new Set(['444', '555', '666']));
  });
});
