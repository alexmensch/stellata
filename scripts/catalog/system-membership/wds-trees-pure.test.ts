import { describe, expect, it } from 'vitest';

import { unitVectorFromRaDec, type UnitVector } from '../../../src/astro-core/equatorial-basis';
import type { SystemNode } from '../../../src/catalog-format/system-membership/system-membership-format';
import { wdsIdPosition } from '../../wds/wds-pure';
import { WDS_IDENTITY_MAX_ARCMIN, wdsTrees, type WdsPairEnds } from './wds-trees-pure';

const pair = (wdsId: string, primaryComp: string, secondaryComp: string, primary: number | null, secondary: number | null): WdsPairEnds =>
  ({ pair: { wdsId, primaryComp, secondaryComp }, rendered: { primary, secondary } });

const r = (record: number): SystemNode => ({ kind: 'record', record });
const g = (component: string | null, ...children: SystemNode[]): SystemNode => ({ kind: 'group', component, children });

const atWds = (wdsId: string, offsetArcmin = 0): UnitVector => {
  const p = wdsIdPosition(wdsId)!;
  return unitVectorFromRaDec(p.raDeg, p.decDeg + offsetArcmin / 60);
};

const CASTOR = '07346+3153';
const castorPairs = [
  pair(CASTOR, 'A', 'B', 1, 2),
  pair(CASTOR, 'A', 'C', 1, 3),
  pair(CASTOR, 'Aa', 'Ab', 1, 4),
  pair(CASTOR, 'Ba', 'Bb', 2, 5),
  pair(CASTOR, 'Ca', 'Cb', 3, 6),
];

describe('wdsTrees', () => {
  it('nests Castor: each component group holds its close pair, the re-homed primary at its deepest token', () => {
    const { trees } = wdsTrees(castorPairs, () => atWds(CASTOR));
    expect(trees).toEqual([{ wdsId: CASTOR, root: g(null, g('A', r(1), r(4)), g('B', r(2), r(5)), g('C', r(3), r(6))) }]);
  });

  it('groups an unresolved compound around its single-letter members', () => {
    const id = '03328-0928';
    const { trees } = wdsTrees([pair(id, 'A', 'BC', 1, null), pair(id, 'B', 'C', 2, 3)], () => atWds(id));
    expect(trees[0].root).toEqual(g(null, r(1), g('BC', r(2), r(3))));
  });

  it('collapses a chain of one-child groups and walks digit tokens up to their letter', () => {
    const id = '03082+4057';
    const { trees } = wdsTrees([pair(id, 'Aa1', 'Aa2', 1, 2), pair(id, 'Aa', 'Ab', 1, 3), pair(id, 'A', 'C', 1, 4)], () => atWds(id));
    expect(trees[0].root).toEqual(g(null, g('A', g('Aa', r(1), r(2)), r(3)), r(4)));
  });

  it('forms no tree from fewer than two records', () => {
    expect(wdsTrees([pair(CASTOR, 'A', 'B', 1, null)], () => atWds(CASTOR)).trees).toEqual([]);
    expect(wdsTrees([pair(CASTOR, 'A', 'B', 1, 1)], () => atWds(CASTOR)).trees).toEqual([]);
  });

  it('keeps a record claimed by two WDS ids only in the one whose coordinates it sits within the identity bound of', () => {
    const near = '00119-3533';
    const far = '00111-0008';
    const pairs = [pair(near, 'A', 'B', 1, 9), pair(far, 'A', 'B', 7, 9), pair(far, 'A', 'C', 7, 8)];
    const { trees, counts } = wdsTrees(pairs, (i) => (i === 9 || i === 1 ? atWds(near) : atWds(far)));
    expect(trees).toEqual([
      { wdsId: far, root: g(null, r(7), r(8)) },
      { wdsId: near, root: g(null, r(1), r(9)) },
    ]);
    expect(counts).toMatchObject({ systemWdsIdentityGated: 1, systemWdsAmbiguous: 0 });
  });

  it('places a record that two nearby WDS ids both claim in neither', () => {
    const a = '08514+1148';
    const b = '08514+1149';
    const pairs = [pair(a, 'A', 'B', 1, 5), pair(a, 'A', 'C', 1, 2), pair(b, 'A', 'B', 3, 5), pair(b, 'A', 'C', 3, 4)];
    const { trees, counts } = wdsTrees(pairs, () => atWds(a, 0.5));
    expect(trees.map((t) => t.root)).toEqual([g(null, r(1), r(2)), g(null, r(3), r(4))]);
    expect(counts).toMatchObject({ systemWdsIdentityGated: 0, systemWdsAmbiguous: 1 });
  });

  it('gates at the bound, not before it', () => {
    const a = '12000+0000';
    const b = '12000+3000';
    const pairs = [pair(a, 'A', 'B', 1, 9), pair(b, 'A', 'B', 2, 9)];
    const inside = wdsTrees(pairs, (i) => (i === 9 ? atWds(a, WDS_IDENTITY_MAX_ARCMIN - 0.01) : atWds(a)));
    expect(inside.counts.systemWdsIdentityGated).toBe(1);
  });

  it('places a record standing for both ends of a pair at their shared token, or the root, and counts no conflict', () => {
    const id = '00568+3830';
    const { trees, counts } = wdsTrees([
      pair(id, 'Aa', 'Ab', 1, 1), pair(id, 'A', 'B', 1, 2), pair(id, 'Ba', 'Bb', 2, 2), pair(id, 'A', 'C', 3, 3), pair(id, 'A', 'D', 1, 4),
    ], () => atWds(id));
    expect(trees[0].root).toEqual(g(null, r(3), r(1), r(2), r(4)));
    expect(counts.systemWdsTokenConflicts).toBe(0);
  });

  it('counts a record one system reaches under unrelated tokens, placing it at the most canonical', () => {
    const { trees, counts } = wdsTrees([pair(CASTOR, 'A', 'B', 1, 2), pair(CASTOR, 'C', 'D', 1, 3)], () => atWds(CASTOR));
    expect(counts.systemWdsTokenConflicts).toBe(1);
    expect(trees[0].root).toEqual(g(null, r(1), r(2), r(3)));
  });
});
