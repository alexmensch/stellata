import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FLAG_HAS_ORBIT, type BinariesData } from '../binaries-loader';
import { makeRelation } from '../binary-relation-fixture';
import { relationIndicesInBounds } from '../orbit-relation-cache';
import { BinaryOrbitPathLayer, type RelationOffsetSource } from './binary-orbit-path-layer';
import { builtinChromeLineMaterials as chromeLines } from '../../chrome-lines/builtin-chrome-lines';

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
// primary slot (idx 0) at (2,0,0); secondary slot (idx 1) at (0,5,0), the
// walk's R(t) between them → barycentre = secondary − (1−q)·R = (1.2, 2, 0).
const LOCAL = new Float32Array([2, 0, 0, 0, 5, 0]);
const OFFSET_R = new THREE.Vector3(-2, 5, 0);
const BARYCENTRE = new THREE.Vector3(1.2, 2, 0);
const VIEWPORT_H = 1000;

function offsetsOf(r: THREE.Vector3): RelationOffsetSource {
  return { relationOffsetPcInto: (_ri, out) => { out.copy(r); return true; } };
}
const OFFSETS = offsetsOf(OFFSET_R);

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
    const layer = new BinaryOrbitPathLayer(chromeLines());
    layer.setSystem(SINGLE, 0, ABS);
    expect(layer.group.children.length).toBe(1);
    layer.dispose();
  });

  it('traces nothing for a visual companion, a null system, or an unfocused star', () => {
    const layer = new BinaryOrbitPathLayer(chromeLines());
    layer.setSystem(VISUAL, 0, ABS);
    expect(layer.group.children.length).toBe(0);
    layer.setSystem(SINGLE, null, ABS);
    expect(layer.group.children.length).toBe(0);
    layer.setSystem(null, 0, ABS);
    expect(layer.group.children.length).toBe(0);
    layer.dispose();
  });

  it('skips a relation whose member indices fall outside the position buffer', () => {
    const layer = new BinaryOrbitPathLayer(chromeLines());
    layer.setSystem(SINGLE, 0, new Float32Array([10, 0, 0]));
    expect(layer.group.children.length).toBe(0);
    layer.dispose();
  });
});

describe('BinaryOrbitPathLayer.update', () => {
  it('parks each pair-group at the barycentre secondary − (1−q)·R(t)', () => {
    const layer = new BinaryOrbitPathLayer(chromeLines());
    layer.setSystem(SINGLE, 0, ABS);
    layer.update(OFFSETS, LOCAL, CLOSE(), VIEWPORT_H);
    const pos = layer.group.children[0].position;
    expect(pos.x).toBeCloseTo(BARYCENTRE.x, 12);
    expect(pos.y).toBeCloseTo(BARYCENTRE.y, 12);
    expect(pos.z).toBeCloseTo(BARYCENTRE.z, 12);
    layer.dispose();
  });

  it('holds the barycentre still when an inner pair splits the shared primary slot', () => {
    // Algol's shape: the outer pair's primary is also an inner pair's
    // primary, so the walk moves that slot again AFTER placing the outer
    // secondary. The outer ellipses must not follow it — the mass-weighted
    // average of the two slots would drag them 0.6 pc down z here.
    const layer = new BinaryOrbitPathLayer(chromeLines());
    layer.setSystem(SINGLE, 0, ABS);
    const innerSplit = new Float32Array(LOCAL);
    innerSplit[2] -= 1;
    layer.update(OFFSETS, innerSplit, CLOSE(), VIEWPORT_H);
    const pos = layer.group.children[0].position;
    expect(pos.x).toBeCloseTo(BARYCENTRE.x, 12);
    expect(pos.y).toBeCloseTo(BARYCENTRE.y, 12);
    expect(pos.z).toBeCloseTo(BARYCENTRE.z, 12);
    layer.dispose();
  });

  it('draws no pair when the walk has not evaluated its relation', () => {
    const layer = new BinaryOrbitPathLayer(chromeLines());
    layer.setSystem(SINGLE, 0, ABS);
    layer.update(null, LOCAL, CLOSE(), VIEWPORT_H);
    expect(layer.group.children[0].visible).toBe(false);
    expect(layer.anyOrbitRingVisible()).toBe(false);
    layer.dispose();
  });

  it('hides a pair once its orbit shrinks below the on-screen-size gate', () => {
    const layer = new BinaryOrbitPathLayer(chromeLines());
    layer.setSystem(SINGLE, 0, ABS);
    layer.update(OFFSETS, LOCAL, CLOSE(), VIEWPORT_H);
    expect(layer.group.children[0].visible).toBe(true);
    layer.update(OFFSETS, LOCAL, FAR(), VIEWPORT_H);
    expect(layer.group.children[0].visible).toBe(false);
    layer.dispose();
  });
});

describe('BinaryOrbitPathLayer.anyOrbitRingVisible', () => {
  it('tracks whether a focused system draws a large-enough path this frame', () => {
    const layer = new BinaryOrbitPathLayer(chromeLines());
    expect(layer.anyOrbitRingVisible()).toBe(false);
    layer.setSystem(SINGLE, 0, ABS);
    layer.update(OFFSETS, LOCAL, CLOSE(), VIEWPORT_H);
    expect(layer.anyOrbitRingVisible()).toBe(true);
    // Zoomed far out — the orbit is sub-pixel, so the focus ring should
    // take back over.
    layer.update(OFFSETS, LOCAL, FAR(), VIEWPORT_H);
    expect(layer.anyOrbitRingVisible()).toBe(false);
    // Decluttered (representational off) hides it even when close.
    layer.update(OFFSETS, LOCAL, CLOSE(), VIEWPORT_H);
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
