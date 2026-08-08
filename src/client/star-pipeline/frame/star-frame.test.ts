import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeEmptyCatalog } from '../../loaders/catalog-mock';
import type { Catalog } from '../../loaders/catalog-loader';
import { julianEpochYearToT } from '../../solar-system/time/time';
import { R_SUN_PC } from '../../util/astronomy-constants';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { StarFrame } from './star-frame';
import { buildSharedUniforms } from '../../frame/shared-uniforms';

const T_LOAD = julianEpochYearToT(2016.0);

function makeCatalog(positions: number[][], radiiRsol?: number[]): Catalog {
  const catalog = makeEmptyCatalog(positions.length);
  positions.forEach((p, i) => {
    catalog.positions[i * 3] = p[0];
    catalog.positions[i * 3 + 1] = p[1];
    catalog.positions[i * 3 + 2] = p[2];
  });
  if (radiiRsol) catalog.physicalRadius.set(radiiRsol);
  return catalog;
}

function makeFrame(catalog: Catalog, opts: { t?: number } = {}) {
  const uniforms = buildSharedUniforms({
    pixelRatio: 1,
    fovYRad: Math.PI / 4,
    viewportW: 1000,
    viewportH: 1000,
    hdr: makeHdrEmitterUniforms(),
  });
  const cameraPosition = new THREE.Vector3();
  let writes = 0;
  const frame = new StarFrame({
    catalog,
    uniforms,
    cameraPosition,
    t: opts.t ?? T_LOAD,
    onLocalPositionsWritten: () => { writes += 1; },
  });
  return { frame, uniforms, cameraPosition, writeCount: () => writes };
}

describe('StarFrame construction', () => {
  it('derives the per-instance buffers off the advanced positions', () => {
    const catalog = makeCatalog([[3, 4, 0], [0, 0, 10]], [1, 100]);
    const { frame } = makeFrame(catalog);

    expect(Array.from(frame.distSol)).toEqual([5, 10]);
    expect(frame.logRadii[1]).toBeCloseTo(2, 12);
    expect(Array.from(frame.lumClassF32)).toEqual([255, 255]);
    expect(frame.maxPhysicalRadiusPc).toBeCloseTo(100 * R_SUN_PC, 12);
  });

  it('snapshots an immutable J2016.0 baseline and advances the catalog to t', () => {
    const catalog = makeCatalog([[0, 0, 0]]);
    catalog.velocities[0] = 2; // pc/yr along +x
    const { frame } = makeFrame(catalog, { t: julianEpochYearToT(2116.0) });

    expect(frame.basePositions[0]).toBe(0);
    expect(catalog.positions[0]).toBeCloseTo(200, 3);
    expect(frame.localPositions[0]).toBeCloseTo(200, 3);
  });

  it('sorts the Sol-distance index ascending', () => {
    const catalog = makeCatalog([[0, 0, 9], [0, 0, 1], [0, 0, 5]]);
    const { frame } = makeFrame(catalog);

    expect(Array.from(frame.sortedByDistFromSol)).toEqual([1, 2, 0]);
    expect(Array.from(frame.sortedDistFromSol)).toEqual([1, 5, 9]);
  });
});

describe('StarFrame.recenterTo', () => {
  it('rewrites the local buffer and mirrors the origin into uWorldOffset', () => {
    const catalog = makeCatalog([[10, 0, 0], [12, 0, 0]]);
    const { frame, uniforms, writeCount } = makeFrame(catalog);

    const delta = frame.recenterTo(new THREE.Vector3(10, 0, 0));

    expect(delta?.toArray()).toEqual([10, 0, 0]);
    expect(Array.from(frame.localPositions.slice(0, 6))).toEqual([0, 0, 0, 2, 0, 0]);
    expect(frame.worldOffset.toArray()).toEqual([10, 0, 0]);
    expect(uniforms.uWorldOffset.value.toArray()).toEqual([10, 0, 0]);
    expect(writeCount()).toBe(1);
    // Absolute positions are untouched — only the frame moved.
    expect(Array.from(catalog.positions.slice(0, 3))).toEqual([10, 0, 0]);
  });

  it('is a no-op when the origin already matches', () => {
    const catalog = makeCatalog([[10, 0, 0]]);
    const { frame, writeCount } = makeFrame(catalog);

    frame.recenterTo(new THREE.Vector3(4, 0, 0));
    expect(frame.recenterTo(new THREE.Vector3(4, 0, 0))).toBeNull();
    expect(writeCount()).toBe(1);
  });
});

describe('StarFrame.advanceEpochTo', () => {
  it('reports no advance while the clock stays inside the load bucket', () => {
    const catalog = makeCatalog([[0, 0, 0]]);
    catalog.velocities[0] = 1;
    const { frame, writeCount } = makeFrame(catalog);

    expect(frame.advanceEpochTo(T_LOAD, null, new THREE.Vector3())).toBe(false);
    expect(writeCount()).toBe(0);
    expect(frame.advancedEpochJyr).toBe(2016);
  });

  it('re-advances off the baseline and reports the focal space-motion delta', () => {
    const catalog = makeCatalog([[0, 0, 0], [0, 0, 0]]);
    catalog.velocities[0] = 1; // star 0 drifts, star 1 is static
    const { frame } = makeFrame(catalog);

    const delta = new THREE.Vector3();
    expect(frame.advanceEpochTo(julianEpochYearToT(2036.0), 0, delta)).toBe(true);

    expect(frame.advancedEpochJyr).toBeCloseTo(2036, 6);
    expect(delta.x).toBeCloseTo(20, 3);
    expect(catalog.positions[0]).toBeCloseTo(20, 3);
    // A second advance measures from the previous epoch, not the baseline.
    frame.advanceEpochTo(julianEpochYearToT(2046.0), 0, delta);
    expect(delta.x).toBeCloseTo(10, 3);
    expect(catalog.positions[0]).toBeCloseTo(30, 3);
  });

  it('reports a zero delta when nothing is focused', () => {
    const catalog = makeCatalog([[0, 0, 0]]);
    catalog.velocities[0] = 1;
    const { frame } = makeFrame(catalog);

    const delta = new THREE.Vector3().set(9, 9, 9);
    frame.advanceEpochTo(julianEpochYearToT(2036.0), null, delta);
    expect(delta.toArray()).toEqual([0, 0, 0]);
  });

  it('re-derives the local buffer in the current frame, not the load frame', () => {
    const catalog = makeCatalog([[0, 0, 0]]);
    catalog.velocities[0] = 1;
    const { frame } = makeFrame(catalog);
    frame.recenterTo(new THREE.Vector3(100, 0, 0));

    frame.advanceEpochTo(julianEpochYearToT(2036.0), null, new THREE.Vector3());
    frame.flushLocalPositions();

    expect(frame.localPositions[0]).toBeCloseTo(-80, 3);
  });
});

describe('StarFrame local-position rewrite coalescing', () => {
  it('rewrites once when only the epoch advanced', () => {
    const catalog = makeCatalog([[0, 0, 0]]);
    catalog.velocities[0] = 1;
    const { frame, writeCount } = makeFrame(catalog);

    frame.advanceEpochTo(julianEpochYearToT(2036.0), null, new THREE.Vector3());
    expect(writeCount()).toBe(0);
    frame.flushLocalPositions();
    expect(writeCount()).toBe(1);
    expect(frame.localPositions[0]).toBeCloseTo(20, 3);
  });

  it('rewrites once when an epoch advance and a recentre fire the same frame', () => {
    const catalog = makeCatalog([[0, 0, 0]]);
    catalog.velocities[0] = 1;
    const { frame, writeCount } = makeFrame(catalog);

    frame.advanceEpochTo(julianEpochYearToT(2036.0), null, new THREE.Vector3());
    frame.recenterTo(new THREE.Vector3(20, 0, 0));
    frame.flushLocalPositions();

    expect(writeCount()).toBe(1);
    // Identical to the two-pass result: the recentre's rewrite already
    // read the freshly advanced absolute positions.
    expect(frame.localPositions[0]).toBeCloseTo(0, 6);
  });

  it('leaves the buffer alone on a frame with neither', () => {
    const catalog = makeCatalog([[0, 0, 0]]);
    const { frame, writeCount } = makeFrame(catalog);

    frame.advanceEpochTo(T_LOAD, null, new THREE.Vector3());
    frame.flushLocalPositions();
    frame.flushLocalPositions();

    expect(writeCount()).toBe(0);
  });
});

describe('StarFrame proximity queries', () => {
  it('walks only stars inside the camera window and stops early on request', () => {
    const catalog = makeCatalog([[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 50]]);
    const { frame, cameraPosition } = makeFrame(catalog);
    cameraPosition.set(0, 0, 1);

    const seen: number[] = [];
    frame.forEachStarNearCamera(1.5, (i) => { seen.push(i); return false; });
    expect(seen.sort()).toEqual([0, 1, 2]);

    const first: number[] = [];
    frame.forEachStarNearCamera(1.5, (i) => { first.push(i); return true; });
    expect(first).toHaveLength(1);
  });

  it('walks in the local frame after a recentre', () => {
    const catalog = makeCatalog([[100, 0, 0], [100, 0, 1], [0, 0, 0]]);
    const { frame, cameraPosition } = makeFrame(catalog);
    frame.recenterTo(new THREE.Vector3(100, 0, 0));
    cameraPosition.set(0, 0, 0);

    const seen: number[] = [];
    frame.forEachStarNearCamera(2, (i) => { seen.push(i); return false; });
    expect(seen.sort()).toEqual([0, 1]);
  });

  it('gates the core mask on a star inside the largest-disc window', () => {
    // 1 Rsol at 1000 px viewport / 45° FOV resolves 5 px well inside 1e-6 pc.
    const catalog = makeCatalog([[0, 0, 0]]);
    const { frame, cameraPosition } = makeFrame(catalog);

    cameraPosition.set(0, 0, frame.discWindowPcFor(5) * 0.5);
    expect(frame.shouldEnableCoreMask()).toBe(true);

    cameraPosition.set(0, 0, frame.discWindowPcFor(5) * 2);
    expect(frame.shouldEnableCoreMask()).toBe(false);
  });

  it('scales the disc window with the live FOV / viewport uniforms', () => {
    const catalog = makeCatalog([[0, 0, 0]], [10]);
    const { frame, uniforms } = makeFrame(catalog);

    const before = frame.discWindowPcFor(5);
    uniforms.uViewport.value.y = 2000;
    expect(frame.discWindowPcFor(5)).toBeGreaterThan(before);
  });
});
