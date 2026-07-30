import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { BoundaryArtifact } from '../../../scripts/catalog/boundaries/boundaries-artifact-pure';
import { SPHERE_RADIUS_PC } from '../galactic/coord-spheres/coord-sphere';
import type { ScreenMetricUniforms } from '../util/orbit-line';
import {
  BOUNDARY_DOT_PX,
  BOUNDARY_GAP_PX,
  ConstellationBoundaryLayer,
} from './constellation-boundary-layer';

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

const VIEWPORT_H_PX = 1080;
const FOV_Y_RAD = Math.PI / 3.6;

function sharedUniforms(): ScreenMetricUniforms {
  return {
    uFovYRad: { value: FOV_Y_RAD },
    uViewport: { value: new THREE.Vector2(1920, VIEWPORT_H_PX) },
  };
}

function attached(maxAppMag = 6): ConstellationBoundaryLayer {
  const layer = new ConstellationBoundaryLayer(sharedUniforms());
  layer.attach(ARTIFACT, maxAppMag);
  return layer;
}

function positionsOf(layer: ConstellationBoundaryLayer): Float32Array {
  const lines = layer.group.children[0] as THREE.LineSegments;
  return lines.geometry.getAttribute('position').array as Float32Array;
}

describe('ConstellationBoundaryLayer', () => {
  it('draws nothing before the artifact resolves', () => {
    const layer = new ConstellationBoundaryLayer(sharedUniforms());
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

  // Dotted, per Sky Atlas 2000.0. The dash phase has to ride the geometry as
  // its own attribute: LineSegments + computeLineDistances resets it per pair,
  // and a pair shorter than one dot then draws solid.
  it('draws the arcs dotted, with the dash phase on the geometry', () => {
    const layer = attached();
    const lines = layer.group.children[0] as THREE.LineSegments;
    const material = lines.material as THREE.LineDashedMaterial;
    expect(material).toBeInstanceOf(THREE.LineDashedMaterial);
    // A dot shorter than its gap — dotted, not a dashed rule.
    expect(material.dashSize).toBe(BOUNDARY_DOT_PX);
    expect(material.gapSize).toBe(BOUNDARY_GAP_PX);
    expect(BOUNDARY_DOT_PX).toBeLessThan(BOUNDARY_GAP_PX);
    const phase = lines.geometry.getAttribute('lineDistance');
    expect(phase.count).toBe(lines.geometry.getAttribute('position').count);
    layer.dispose();
  });

  // The pattern is authored in pixels, so `scale` is the world→screen
  // conversion. A stale scale (never written, or written once at construction)
  // leaves the dots the size of a parsec on a 50 kpc sphere — invisible.
  it('scales the dot pattern into screen pixels for the live FOV', () => {
    const layer = attached();
    const lines = layer.group.children[0] as THREE.LineSegments;
    const material = lines.material as THREE.LineDashedMaterial;

    layer.update(ORIGIN, 0);
    const pxPerRad = VIEWPORT_H_PX / FOV_Y_RAD;
    expect(material.scale).toBeCloseTo(pxPerRad / SPHERE_RADIUS_PC, 12);
    // `scale` is the only thing that converts them, so the pattern stays in
    // the pixel units it was authored in.
    expect(material.dashSize).toBe(BOUNDARY_DOT_PX);
    expect(material.gapSize).toBe(BOUNDARY_GAP_PX);
    layer.dispose();
  });

  it('follows a FOV change — zooming in must not stretch the dots', () => {
    const shared = sharedUniforms();
    const layer = new ConstellationBoundaryLayer(shared);
    layer.attach(ARTIFACT, 6);
    layer.update(ORIGIN, 0);
    const wide = (layer.group.children[0] as THREE.LineSegments)
      .material as THREE.LineDashedMaterial;
    const scaleAtWideFov = wide.scale;

    shared.uFovYRad.value = FOV_Y_RAD / 4;
    layer.update(ORIGIN, 0);
    expect(wide.scale).toBeCloseTo(scaleAtWideFov * 4, 12);
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
    const layer = new ConstellationBoundaryLayer(sharedUniforms());
    layer.setMagnitudeLimit(8);
    layer.attach(ARTIFACT, 8);
    layer.update(ORIGIN, 0);
    expect(layer.group.visible).toBe(true);
    layer.dispose();
  });

  it('dispose drops the geometry and the fade window', () => {
    const layer = attached();
    layer.dispose();
    expect(layer.group.children.length).toBe(0);
    // The window went with the table, so a later push cannot revive the layer:
    // setMagnitudeLimit's no-table guard swallows it before the sentinel is
    // ever consulted.
    layer.setMagnitudeLimit(6);
    layer.update(ORIGIN, 0);
    expect(layer.group.visible).toBe(false);
  });

  // The fade is the layer's whole correctness property — a window that reads
  // as NaN would leave a wrong partition drawn from everywhere, since a NaN
  // opacity never trips the `<= 0` hide.
  it('hides rather than drawing at NaN opacity on an unusable window', () => {
    const layer = attached();
    layer.setMagnitudeLimit(NaN);
    layer.update(ORIGIN, 1e9);
    expect(layer.group.visible).toBe(false);
    layer.dispose();
  });
});
