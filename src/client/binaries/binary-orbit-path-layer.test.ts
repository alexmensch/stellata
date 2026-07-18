import { describe, expect, it } from 'vitest';
import { FLAG_HAS_ORBIT, type BinariesData } from './binaries-loader';
import { makeRelation } from './binary-relation-fixture';
import { relationIndicesInBounds } from './orbit-relation-cache';
import { BinaryOrbitPathLayer } from './binary-orbit-path-layer';

// One Kepler pair 0↔1 (q = 0.4, Tier 2 — no inclination flag). Focusing
// star 0 puts the relation on its chain.
const PAIR_Q = 0.4;
const SINGLE: BinariesData = {
  version: 1,
  relations: [makeRelation({ primaryIdx: 0, secondaryIdx: 1, flags: FLAG_HAS_ORBIT, q: PAIR_Q })],
  primaryIdxToRelations: new Map([[0, [0]]]),
  secondaryIdxToRelations: new Map([[1, [0]]]),
};

// Same topology but the pair is a visual companion (no has_orbit) — nothing
// to trace.
const VISUAL: BinariesData = {
  version: 1,
  relations: [makeRelation({ primaryIdx: 0, secondaryIdx: 1, flags: 0 })],
  primaryIdxToRelations: new Map([[0, [0]]]),
  secondaryIdxToRelations: new Map([[1, [0]]]),
};

const ABS = new Float32Array([10, 0, 0, 10, 0, 0]);

describe('BinaryOrbitPathLayer.setSystem', () => {
  it('builds one pair-group per Kepler relation on the focal chain', () => {
    const layer = new BinaryOrbitPathLayer();
    layer.setSystem(SINGLE, 0, ABS);
    expect(layer.group.children.length).toBe(1);
    layer.dispose();
  });

  it('traces nothing for a visual companion, a null system, or an unfocused star', () => {
    const layer = new BinaryOrbitPathLayer();
    layer.setSystem(VISUAL, 0, ABS);
    expect(layer.group.children.length).toBe(0);
    layer.setSystem(SINGLE, null, ABS);
    expect(layer.group.children.length).toBe(0);
    layer.setSystem(null, 0, ABS);
    expect(layer.group.children.length).toBe(0);
    layer.dispose();
  });

  it('skips a relation whose member indices fall outside the position buffer', () => {
    const layer = new BinaryOrbitPathLayer();
    layer.setSystem(SINGLE, 0, new Float32Array([10, 0, 0]));
    expect(layer.group.children.length).toBe(0);
    layer.dispose();
  });
});

describe('BinaryOrbitPathLayer.update', () => {
  it('parks each pair-group at the barycentre (1−q)·primary + q·secondary', () => {
    const layer = new BinaryOrbitPathLayer();
    layer.setSystem(SINGLE, 0, ABS);
    // primary slot (idx 0) at (2,0,0); secondary slot (idx 1) at (0,5,0).
    layer.update(new Float32Array([2, 0, 0, 0, 5, 0]));
    const pos = layer.group.children[0].position;
    expect(pos.x).toBeCloseTo((1 - PAIR_Q) * 2, 12);
    expect(pos.y).toBeCloseTo(PAIR_Q * 5, 12);
    expect(pos.z).toBeCloseTo(0, 12);
    layer.dispose();
  });
});

describe('BinaryOrbitPathLayer.anyOrbitRingVisible', () => {
  it('is false with no system, true while a focused system draws, false once decluttered', () => {
    const layer = new BinaryOrbitPathLayer();
    expect(layer.anyOrbitRingVisible()).toBe(false);
    layer.setSystem(SINGLE, 0, ABS);
    expect(layer.anyOrbitRingVisible()).toBe(true);
    layer.setPermitted(false);
    expect(layer.anyOrbitRingVisible()).toBe(false);
    layer.setPermitted(true);
    layer.setSystem(null, 0, ABS);
    expect(layer.anyOrbitRingVisible()).toBe(false);
    layer.dispose();
  });
});

describe('relationIndicesInBounds', () => {
  const r = makeRelation({ primaryIdx: 2, secondaryIdx: 4 });
  it('requires both members’ xyz triples inside the buffer', () => {
    expect(relationIndicesInBounds(r, 15)).toBe(true); // 4*3+2 = 14 < 15
    expect(relationIndicesInBounds(r, 14)).toBe(false); // secondary just out
    expect(relationIndicesInBounds(makeRelation({ primaryIdx: 5, secondaryIdx: 0 }), 15)).toBe(false);
  });
});
