import { describe, expect, it } from 'vitest';
import { AU_PC } from '../util/astronomy-constants';
import { FLAG_HAS_ORBIT, NO_PARENT, type BinariesData } from './binaries-loader';
import { type OrbitalElements } from './binary-orbit-pure';
import { makeRelation } from './binary-relation-fixture';
import { keplerChainRelationIdxs, buildBinaryOrbitRingPoints } from './binary-orbit-path-pure';

// Outer pair 0↔2 (relation 0) has real Kepler elements; inner pair 0↔1
// (relation 1, child of 0) is a visual companion — no has_orbit flag.
const MIXED: BinariesData = {
  version: 1,
  relations: [
    makeRelation({ primaryIdx: 0, secondaryIdx: 2, parentRelation: NO_PARENT, flags: FLAG_HAS_ORBIT }),
    makeRelation({ primaryIdx: 0, secondaryIdx: 1, parentRelation: 0, flags: 0 }),
  ],
  primaryIdxToRelations: new Map([[0, [0, 1]]]),
  secondaryIdxToRelations: new Map([[1, [1]], [2, [0]]]),
};

describe('keplerChainRelationIdxs', () => {
  it('returns none without binaries data or star focus', () => {
    expect(keplerChainRelationIdxs(null, 0)).toEqual([]);
    expect(keplerChainRelationIdxs(MIXED, null)).toEqual([]);
    expect(keplerChainRelationIdxs(MIXED, 3)).toEqual([]);
  });

  it('excludes visual companions — only has_orbit relations trace a path', () => {
    // Focusing the primary reaches both chain relations, but the visual
    // inner pair (relation 1) carries no orbit, so only relation 0 draws.
    expect(keplerChainRelationIdxs(MIXED, 0)).toEqual([0]);
  });

  it('a focused visual companion still shows its parent pair with elements', () => {
    // Star 1 is the inner (visual) secondary; its own relation is dropped,
    // but the outer parent (relation 0) has a real orbit and is kept.
    expect(keplerChainRelationIdxs(MIXED, 1)).toEqual([0]);
  });
});

const CIRCULAR: OrbitalElements = {
  P: 365, T: 0, e: 0, a: 1, i: 0, omega: 0, Omega: 0, q: 0.3,
};
const SEGMENTS = 64;
const SYSTEM_XYZ = { x: 10, y: 0, z: 0 };

describe('buildBinaryOrbitRingPoints', () => {
  it('emits a closed loop of the requested vertex count per member', () => {
    const { primary, secondary } = buildBinaryOrbitRingPoints(CIRCULAR, 1, SYSTEM_XYZ, SEGMENTS);
    expect(primary.length).toBe(SEGMENTS * 3);
    expect(secondary.length).toBe(SEGMENTS * 3);
  });

  it('places the barycentre at the shared focus — (1−q)·primary + q·secondary = 0', () => {
    const { primary, secondary } = buildBinaryOrbitRingPoints(CIRCULAR, 1, SYSTEM_XYZ, SEGMENTS);
    const q = CIRCULAR.q;
    for (let i = 0; i < SEGMENTS * 3; i++) {
      expect((1 - q) * primary[i] + q * secondary[i]).toBeCloseTo(0, 12);
    }
  });

  it('sizes each ellipse by the opposite mass fraction (circular → radius q·a and (1−q)·a)', () => {
    const { primary, secondary } = buildBinaryOrbitRingPoints(CIRCULAR, 1, SYSTEM_XYZ, SEGMENTS);
    const q = CIRCULAR.q;
    for (let i = 0; i < SEGMENTS; i++) {
      const o = i * 3;
      const rp = Math.hypot(primary[o], primary[o + 1], primary[o + 2]);
      const rs = Math.hypot(secondary[o], secondary[o + 1], secondary[o + 2]);
      expect(rp).toBeCloseTo(q * CIRCULAR.a * AU_PC, 12);
      expect(rs).toBeCloseTo((1 - q) * CIRCULAR.a * AU_PC, 12);
    }
  });

  it('draws the two members anti-phase (primary opposite the secondary each sample)', () => {
    const { primary, secondary } = buildBinaryOrbitRingPoints(CIRCULAR, 1, SYSTEM_XYZ, SEGMENTS);
    const o = 5 * 3;
    const dot = primary[o] * secondary[o] + primary[o + 1] * secondary[o + 1] + primary[o + 2] * secondary[o + 2];
    expect(dot).toBeLessThan(0);
  });
});
