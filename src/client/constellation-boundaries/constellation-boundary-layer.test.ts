import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BoundaryArtifact } from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { SPHERE_RADIUS_PC } from '../galactic/galactic-grid';
import { ConstellationBoundaryLayer } from './constellation-boundary-layer';

const ARTIFACT: BoundaryArtifact = {
  epoch: 'B1875',
  frame: 'ICRS',
  stepDeg: 0.5,
  segments: [
    { k: 'M', c: ['DEL', 'AQL'], d: [1, 0, 0, 0, 1, 0, 0, 0, 1] },
    { k: 'P', c: ['ORI', 'TAU'], d: [0, 1, 0, 0, 0, 1] },
  ],
  fade: {
    magLimits: [6, 8],
    quantilePcts: [0.1, 1, 5, 50],
    offsetsPc: [[0.14, 0.4, 0.9, 7], [0.31, 0.6, 1.5, 10]],
    sampleCounts: [3000, 20000],
  },
};

const ORIGIN = new THREE.Vector3();

function attached(maxAppMag = 6): ConstellationBoundaryLayer {
  const layer = new ConstellationBoundaryLayer();
  layer.attach(ARTIFACT, maxAppMag);
  return layer;
}

function positionsOf(layer: ConstellationBoundaryLayer): Float32Array {
  const lines = layer.group.children[0] as THREE.LineSegments;
  return lines.geometry.getAttribute('position').array as Float32Array;
}

describe('ConstellationBoundaryLayer', () => {
  it('draws nothing before the artifact resolves', () => {
    const layer = new ConstellationBoundaryLayer();
    layer.update(ORIGIN, 0);
    expect(layer.group.visible).toBe(false);
    expect(layer.group.children.length).toBe(0);
    layer.dispose();
  });

  it('builds one Sol-centred line-segment mesh at the sphere radius', () => {
    const layer = attached();
    expect(layer.group.children.length).toBe(1);
    // 2 + 1 segments over the two arcs, two endpoints each.
    expect(positionsOf(layer).length).toBe(6 * 3);
    expect(positionsOf(layer)[0]).toBe(SPHERE_RADIUS_PC);
    layer.dispose();
  });

  it('rebases to −worldOffset so absolute vertices project into the local frame', () => {
    const layer = attached();
    const worldOffset = new THREE.Vector3(120, -40, 7);
    layer.update(worldOffset, 0);
    expect(layer.group.visible).toBe(true);
    expect(layer.group.position.toArray()).toEqual([-120, 40, -7]);
    // The shared worldOffset must never be mutated by the rebase.
    expect(worldOffset.toArray()).toEqual([120, -40, 7]);
    layer.dispose();
  });

  it('self-hides past the fade window instead of drawing a wrong partition', () => {
    const layer = attached();
    layer.update(ORIGIN, 0);
    expect(layer.group.visible).toBe(true);
    layer.update(ORIGIN, 5);
    expect(layer.group.visible).toBe(false);
    layer.dispose();
  });

  it('re-derives the window on a magnitude push — a wider limit outlives a narrower one', () => {
    const bright = attached(6);
    bright.update(ORIGIN, 1);
    expect(bright.group.visible).toBe(false);

    const faint = attached(6);
    faint.setMagnitudeLimit(8);
    faint.update(ORIGIN, 1);
    expect(faint.group.visible).toBe(true);
    bright.dispose();
    faint.dispose();
  });

  // Filter pushes land while the artifact is still in flight. If one of them
  // recorded the limit, attach's own seeding call reads as unchanged and the
  // layer never gets a window.
  it('survives a magnitude push that arrives before the artifact', () => {
    const layer = new ConstellationBoundaryLayer();
    layer.setMagnitudeLimit(8);
    layer.attach(ARTIFACT, 8);
    layer.update(ORIGIN, 0);
    expect(layer.group.visible).toBe(true);
    layer.dispose();
  });

  it('dispose drops the geometry and re-arms the magnitude sentinel', () => {
    const layer = attached();
    layer.dispose();
    expect(layer.group.children.length).toBe(0);
    // The sentinel was reset, so the same limit pushes through rather than
    // being swallowed as unchanged — and with no table there is no window.
    layer.setMagnitudeLimit(6);
    layer.update(ORIGIN, 0);
    expect(layer.group.visible).toBe(false);
  });
});
