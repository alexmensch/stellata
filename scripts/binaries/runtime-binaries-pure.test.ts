import { describe, expect, it } from 'vitest';

import {
  FLAG_HAS_INCLINATION, FLAG_HAS_ORBIT, FLAG_IS_INNER_OF_HIERARCHY, NO_PARENT,
  type BinaryRecord,
} from '../../src/catalog-format/binaries/binaries-format';
import type { CatalogRowIndexMap } from '../catalog/companions/record-index/catalog-row-index-map-pure';
import { resolvePairs } from '../catalog/companions/record-index/pair-resolution-pure';
import { ORBIT, pair } from './pair-fixture';
import type { MultiplesPair } from './pairs-pure';
import { multiplesHandshake, planRecords, sameRelationAlias } from './runtime-binaries-pure';

function map(over: Partial<CatalogRowIndexMap> = {}): CatalogRowIndexMap {
  return { byGaia: { 1: 100, 2: 200, 3: 300, 4: 400 }, byHip: {}, bySynth: {}, ...over };
}

function plan(pairs: MultiplesPair[], parents: number[], m: CatalogRowIndexMap = map()) {
  return planRecords(pairs, parents, pairs.map((_, i) => i), resolvePairs(pairs, m).map((r) => r.rendered));
}

/** Plans top-level pairs in input order. */
function planFlat(pairs: MultiplesPair[], m: CatalogRowIndexMap = map()) {
  return plan(pairs, pairs.map(() => NO_PARENT), m);
}

function record(records: readonly BinaryRecord[], i: number) {
  const r = records[i];
  return { primary: r.primaryIdx, secondary: r.secondaryIdx, flags: r.flags, parent: r.parentRelation };
}

describe('planRecords', () => {
  it('drops a pair whose primary or secondary resolves to no record', () => {
    expect(planFlat([pair(undefined, { primaryGaia: '999' })]).counts)
      .toMatchObject({ pairs_emitted: 0, pairs_dropped_primary_unresolved: 1, pairs_dropped_secondary_unresolved: 0 });
    expect(planFlat([pair(undefined, { secondaryGaia: '999' })]).counts)
      .toMatchObject({ pairs_emitted: 0, pairs_dropped_secondary_unresolved: 1 });
  });

  it('drops a pair whose two ends resolve to one record, by gaia or by a shared HIP', () => {
    expect(planFlat([pair(undefined, { secondaryGaia: '1' })]).counts)
      .toMatchObject({ pairs_emitted: 0, pairs_dropped_degenerate_idx: 1, pairs_dropped_primary_unresolved: 0 });
    const sharedHip = { primaryGaia: null, primaryHip: 36850, secondaryGaia: null, secondaryHip: 36850 };
    expect(planFlat([pair(undefined, sharedHip)], map({ byGaia: {}, byHip: { 36850: 100 } })).counts)
      .toMatchObject({ pairs_emitted: 0, pairs_dropped_degenerate_idx: 1 });
  });

  it('a secondary sharing the primary’s id retries its synth record before reading as degenerate', () => {
    const synth = { bySynth: { 'synth-00000+0000-B': 555 } };
    expect(planFlat([pair(undefined, { secondaryGaia: '1' })], map(synth)).counts)
      .toMatchObject({ pairs_emitted: 1, pairs_dropped_degenerate_idx: 0 });
    const sharedHip = { primaryGaia: null, primaryHip: 36850, secondaryGaia: null, secondaryHip: 36850 };
    expect(planFlat([pair(undefined, sharedHip)], map({ byGaia: {}, byHip: { 36850: 100 }, ...synth })).counts)
      .toMatchObject({ pairs_emitted: 1, pairs_dropped_degenerate_idx: 0 });
  });

  it('re-homes a pair-mate-inherited secondary onto its own synth record (04049-3527 BC)', () => {
    // C carries A's source (an AC pair-mate), not the pair primary B's.
    const { records } = planFlat(
      [pair('00000+0000-BC', { primaryGaia: '2', secondaryGaia: '1' })],
      map({ bySynth: { 'synth-00000+0000-C': 340 } }),
    );
    expect(record(records, 0)).toMatchObject({ primary: 200, secondary: 340 });
  });

  it('re-homes a blended wide-pair primary onto its own synth record (Castor BC)', () => {
    const { records } = planFlat(
      [pair('00000+0000-BC')],
      map({ byGaia: { 1: 100, 2: 320 }, bySynth: { 'synth-00000+0000-B': 179 } }),
    );
    expect(record(records, 0)).toMatchObject({ primary: 179, secondary: 320 });
  });

  it('keeps a primary whose synth record is its own id-first resolve', () => {
    const { records } = planFlat(
      [pair('00000+0000-BC')],
      map({ byGaia: { 1: 179, 2: 320 }, bySynth: { 'synth-00000+0000-B': 179 } }),
    );
    expect(record(records, 0).primary).toBe(179);
  });

  it('counts a duplicate relation of disjoint letters as a collapse, of related ones as an alias', () => {
    const m = map({ byGaia: { 1: 100, 2: 320 } });
    expect(planFlat([pair('00000+0000-AC'), pair('00000+0000-BC')], m).counts).toMatchObject({
      pairs_emitted: 1, pairs_dropped_duplicate_relation: 1, pairs_dropped_same_relation_alias: 0,
    });
    // 18025+4414: AB and Aa,B name one link at two granularities.
    expect(planFlat([pair('00000+0000-AB'), pair('00000+0000-Aa,B')], m).counts).toMatchObject({
      pairs_emitted: 1, pairs_dropped_same_relation_alias: 1, pairs_dropped_duplicate_relation: 0,
    });
  });

  it('a duplicate relation keeps the orbit-bearing member over an earlier element-less one', () => {
    const { records, counts } = planFlat(
      [pair('00000+0000-AC'), pair('00000+0000-BC', ORBIT)],
      map({ byGaia: { 1: 100, 2: 320 } }),
    );
    expect(counts).toMatchObject({ pairs_emitted: 1, pairs_dropped_duplicate_relation: 1, pairs_with_orbit: 1 });
    expect(record(records, 0).flags & FLAG_HAS_ORBIT).toBe(FLAG_HAS_ORBIT);
  });

  it('remaps parent_relation from input to emitted position', () => {
    const pairs = [
      pair('A-AB', { primaryGaia: '1', secondaryGaia: '2' }),
      pair('A-CD', { primaryGaia: '3', secondaryGaia: '4' }),
      pair('A-EF', { primaryGaia: '4', secondaryGaia: '3' }),
    ];
    const { records } = plan(pairs, [NO_PARENT, 0, 1]);
    expect([0, 1, 2].map((i) => record(records, i).parent)).toEqual([NO_PARENT, 0, 1]);
    expect(record(records, 1).flags & FLAG_IS_INNER_OF_HIERARCHY).toBe(FLAG_IS_INNER_OF_HIERARCHY);
  });

  it('a child whose parent was dropped is top-level, not inner', () => {
    const pairs = [pair(undefined, { secondaryGaia: '999' }), pair(undefined, { primaryGaia: '2', secondaryGaia: '3' })];
    const { records, counts } = plan(pairs, [NO_PARENT, 0]);
    expect(counts.pairs_emitted).toBe(1);
    expect(record(records, 0).parent).toBe(NO_PARENT);
    expect(record(records, 0).flags & FLAG_IS_INNER_OF_HIERARCHY).toBe(0);
  });

  it('sets has_orbit only with all six elements, and has_inclination only with it', () => {
    expect(record(planFlat([pair(undefined, ORBIT)]).records, 0).flags).toBe(FLAG_HAS_ORBIT);
    expect(record(planFlat([pair(undefined, { ...ORBIT, iRad: 1 })]).records, 0).flags)
      .toBe(FLAG_HAS_ORBIT | FLAG_HAS_INCLINATION);
    for (const missing of ['pDays', 'tJd', 'e', 'aAU', 'omegaRad', 'q'] as const) {
      expect(record(planFlat([pair(undefined, { ...ORBIT, iRad: 1, [missing]: null })]).records, 0).flags, missing)
        .toBe(0);
    }
  });

  it('a WDS-truncated secondary resolves through its canonical synth key (Algol Aa1,2)', () => {
    const { counts } = planFlat(
      [pair('03082+4057-Aa1,2', { primaryGaia: null, primaryHip: 14576, secondaryGaia: null })],
      { byGaia: {}, byHip: { 14576: 100 }, bySynth: { 'synth-03082+4057-Aa2': 200 } },
    );
    expect(counts).toMatchObject({ pairs_emitted: 1, pairs_dropped_secondary_unresolved: 0 });
  });

  it('an identifier-less secondary resolves through its synthetic id (Algol Aa,Ab)', () => {
    const { records } = planFlat(
      [pair('03082+4057-Aa,Ab', { primaryGaia: null, primaryHip: 14576, secondaryGaia: null })],
      { byGaia: {}, byHip: { 14576: 100 }, bySynth: { 'synth-03082+4057-Ab': 200 } },
    );
    expect(record(records, 0)).toMatchObject({ primary: 100, secondary: 200 });
  });

});

describe('multiplesHandshake', () => {
  it('passes on the same multiples.tsv and refuses another', () => {
    expect(multiplesHandshake('a'.repeat(40), 'a'.repeat(40)).kind).toBe('pass');
    expect(multiplesHandshake('a'.repeat(40), 'b'.repeat(40))).toMatchObject({
      kind: 'fail', message: expect.stringMatching(/build:catalog/),
    });
  });
});

describe('sameRelationAlias', () => {
  const comps = (primaryComp: string, secondaryComp: string): MultiplesPair =>
    pair(undefined, { primaryComp, secondaryComp });

  it('equal tokens, a hierarchy ancestor, or compound containment alias', () => {
    expect(sameRelationAlias(comps('A', 'B'), comps('A', 'B'))).toBe(true);
    expect(sameRelationAlias(comps('A', 'B'), comps('Aa', 'B'))).toBe(true);
    // Tegmine 08122+1739: AC vs AB,C; 18443+3940: BC vs AB,CD.
    expect(sameRelationAlias(comps('A', 'C'), comps('AB', 'C'))).toBe(true);
    expect(sameRelationAlias(comps('B', 'C'), comps('AB', 'CD'))).toBe(true);
  });

  it('disjoint letters on either side are a real collapse', () => {
    // θ¹ Ori: Bb,Bc vs Ba,Bc.
    expect(sameRelationAlias(comps('Bb', 'Bc'), comps('Ba', 'Bc'))).toBe(false);
    expect(sameRelationAlias(comps('A', 'C'), comps('A', 'E'))).toBe(false);
  });
});
