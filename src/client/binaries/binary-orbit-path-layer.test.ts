import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
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
// primary slot (idx 0) at (2,0,0); secondary slot (idx 1) at (0,5,0) →
// barycentre (1−q)·primary + q·secondary = (1.2, 2, 0).
const LOCAL = new Float32Array([2, 0, 0, 0, 5, 0]);
const BARYCENTRE = new THREE.Vector3(1.2, 2, 0);
const VIEWPORT_H = 1000;

function cameraAt(offsetFromBarycentrePc: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(60, 1, 1e-6, 100);
  cam.position.copy(BARYCENTRE).add(new THREE.Vector3(0, 0, offsetFromBarycentrePc));
  return cam;
}
// A 1-AU orbit fills the view from ~2 AU away; from parsecs it is sub-pixel.
const CLOSE = () => cameraAt(1e-5);
const FAR = () => cameraAt(5);

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
    layer.update(LOCAL, CLOSE(), VIEWPORT_H);
    const pos = layer.group.children[0].position;
    expect(pos.x).toBeCloseTo(BARYCENTRE.x, 12);
    expect(pos.y).toBeCloseTo(BARYCENTRE.y, 12);
    expect(pos.z).toBeCloseTo(BARYCENTRE.z, 12);
    layer.dispose();
  });

  it('hides a pair once its orbit shrinks below the on-screen-size gate', () => {
    const layer = new BinaryOrbitPathLayer();
    layer.setSystem(SINGLE, 0, ABS);
    layer.update(LOCAL, CLOSE(), VIEWPORT_H);
    expect(layer.group.children[0].visible).toBe(true);
    layer.update(LOCAL, FAR(), VIEWPORT_H);
    expect(layer.group.children[0].visible).toBe(false);
    layer.dispose();
  });
});

describe('BinaryOrbitPathLayer.anyOrbitRingVisible', () => {
  it('tracks whether a focused system draws a large-enough path this frame', () => {
    const layer = new BinaryOrbitPathLayer();
    expect(layer.anyOrbitRingVisible()).toBe(false);
    layer.setSystem(SINGLE, 0, ABS);
    layer.update(LOCAL, CLOSE(), VIEWPORT_H);
    expect(layer.anyOrbitRingVisible()).toBe(true);
    // Zoomed far out — the orbit is sub-pixel, so the focus ring should
    // take back over.
    layer.update(LOCAL, FAR(), VIEWPORT_H);
    expect(layer.anyOrbitRingVisible()).toBe(false);
    // Decluttered (representational off) hides it even when close.
    layer.update(LOCAL, CLOSE(), VIEWPORT_H);
    layer.setPermitted(false);
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
