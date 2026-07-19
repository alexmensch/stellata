import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeEmptyCatalog } from '../loaders/catalog-mock';
import { FLAG_HAS_ORBIT, type BinariesData } from '../binaries/binaries-loader';
import { makeRelation } from '../binaries/binary-relation-fixture';
import type { BinaryOrbitPathLayer } from '../binaries/binary-orbit-path-layer';
import type { RenderedSizeComponents } from '../camera/controls/star-physics';
import type { MemberSphere } from '../local-depth/slice-pure';
import { MIRROR_CAPACITY, StarLocalMirror } from './star-local-mirror';
import { StarLocalCluster } from './star-local-cluster';
import { RESOLVED_DISC_MIN_PX } from './star-local-cluster-pure';

const STAR_COUNT = 12;

function makeSourceGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute(
    'aCorner',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      2,
    ),
  );
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.setAttribute(
    'iAbsmag',
    new THREE.InstancedBufferAttribute(new Float32Array(STAR_COUNT), 1),
  );
  g.instanceCount = STAR_COUNT;
  return g;
}

function makeBinaries(relations = [makeRelation({ primaryIdx: 4, secondaryIdx: 5, flags: FLAG_HAS_ORBIT })]): BinariesData {
  const primary = new Map<number, number[]>();
  const secondary = new Map<number, number[]>();
  relations.forEach((r, i) => {
    primary.set(r.primaryIdx, [...(primary.get(r.primaryIdx) ?? []), i]);
    secondary.set(r.secondaryIdx, [...(secondary.get(r.secondaryIdx) ?? []), i]);
  });
  return {
    version: 1,
    relations,
    primaryIdxToRelations: primary,
    secondaryIdxToRelations: secondary,
  } as BinariesData;
}

interface Fixture {
  cluster: StarLocalCluster;
  mirror: StarLocalMirror;
  uniform: { value: Int32Array };
  camera: THREE.PerspectiveCamera;
  /** Stars the scan window walk yields, in order. */
  nearStars: number[];
  /** Per-star rendered size components the deps report. */
  sizes: Map<number, RenderedSizeComponents>;
  pathsVisible: { value: boolean };
  pathSpheres: MemberSphere[];
  frame: { monochrome: boolean; focalIdx: number | null; maxAppMag: number };
}

function makeFixture(): Fixture {
  const mirror = new StarLocalMirror(makeSourceGeometry(), 'void main(){}', 'void main(){}', {});
  const uniform = { value: new Int32Array(MIRROR_CAPACITY).fill(-1) };
  const nearStars: number[] = [];
  const sizes = new Map<number, RenderedSizeComponents>();
  const pathsVisible = { value: false };
  const pathSpheres: MemberSphere[] = [];
  const pathLayer = {
    group: new THREE.Group(),
    anyOrbitRingVisible: () => pathsVisible.value,
    collectSpheres: (_c: THREE.PerspectiveCamera, out: MemberSphere[]) => {
      for (const s of pathSpheres) out.push(s);
    },
  } as unknown as BinaryOrbitPathLayer;
  const cluster = new StarLocalCluster(mirror, pathLayer, uniform, {
    catalog: makeEmptyCatalog(STAR_COUNT),
    localPositions: () => new Float32Array(STAR_COUNT * 3),
    renderedSizeComponents: (idx, out) => {
      const c = sizes.get(idx) ?? { appMag: 99, appSizePx: 0, physSizePx: 0 };
      out.appMag = c.appMag;
      out.appSizePx = c.appSizePx;
      out.physSizePx = c.physSizePx;
      return out;
    },
    forEachStarNearCamera: (_d, cb) => {
      for (const idx of nearStars) if (cb(idx)) return;
    },
    scanWindowPc: () => 1,
  });
  return {
    cluster,
    mirror,
    uniform,
    camera: new THREE.PerspectiveCamera(),
    nearStars,
    sizes,
    pathsVisible,
    pathSpheres,
    frame: { monochrome: false, focalIdx: null, maxAppMag: 6.5 },
  };
}

function members(fx: Fixture): number[] {
  return Array.from(fx.uniform.value).filter((v) => v >= 0);
}

function resolvedDisc(fx: Fixture, idx: number): void {
  fx.sizes.set(idx, { appMag: 0, appSizePx: 4, physSizePx: RESOLVED_DISC_MIN_PX * 4 });
}

describe('StarLocalCluster membership', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });

  it('is inactive with no host, no chain, and no resolved discs', () => {
    fx.nearStars.push(1, 2);
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([]);
    const spheres: MemberSphere[] = [];
    fx.cluster.collectSpheres(fx.camera, spheres);
    expect(spheres).toEqual([]);
  });

  it('mirrors the active planet-system host unconditionally', () => {
    fx.cluster.setHostMember(7);
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([7]);
    const spheres: MemberSphere[] = [];
    fx.cluster.collectSpheres(fx.camera, spheres);
    expect(spheres).toHaveLength(1);
  });

  it('mirrors a resolved-disc star found by the scan', () => {
    fx.nearStars.push(3);
    resolvedDisc(fx, 3);
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([3]);
  });

  it('skips scan stars past the magnitude limit or glow-sized', () => {
    fx.nearStars.push(3, 4);
    fx.sizes.set(3, { appMag: 20, appSizePx: 4, physSizePx: 40 });     // slider-hidden
    fx.sizes.set(4, { appMag: 0, appSizePx: 40, physSizePx: 4 });      // glow pass
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([]);
  });

  it('mirrors the whole focal Kepler chain once its paths draw', () => {
    fx.cluster.setBinaries(makeBinaries());
    fx.frame.focalIdx = 4;
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([]);

    fx.pathsVisible.value = true;
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([4, 5]);
  });

  it('mirrors the whole chain when any one member resolves as a disc', () => {
    fx.cluster.setBinaries(makeBinaries());
    fx.frame.focalIdx = 5;
    resolvedDisc(fx, 4);
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([4, 5]);
  });

  it('deduplicates a star reported by several triggers', () => {
    fx.cluster.setHostMember(4);
    fx.cluster.setBinaries(makeBinaries());
    fx.frame.focalIdx = 4;
    fx.nearStars.push(4, 5);
    resolvedDisc(fx, 4);
    resolvedDisc(fx, 5);
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([4, 5]);
  });

  it('caps membership at MIRROR_CAPACITY', () => {
    for (let i = 0; i < STAR_COUNT; i++) {
      fx.nearStars.push(i);
      resolvedDisc(fx, i);
    }
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toHaveLength(MIRROR_CAPACITY);
  });

  it('deactivates everything in chart mode', () => {
    fx.cluster.setHostMember(7);
    fx.nearStars.push(3);
    resolvedDisc(fx, 3);
    fx.frame.monochrome = true;
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([]);
    expect(fx.mirror.group.visible).toBe(false);
  });

  it('clears stale members and uniform slots on the next update', () => {
    fx.cluster.setHostMember(7);
    fx.cluster.update(fx.camera, fx.frame);
    fx.cluster.setHostMember(null);
    fx.cluster.update(fx.camera, fx.frame);
    expect(members(fx)).toEqual([]);
    expect(Array.from(fx.uniform.value)).toEqual(
      Array.from({ length: MIRROR_CAPACITY }, () => -1),
    );
  });

  it('replays path-layer extent spheres into the bracket', () => {
    fx.cluster.setHostMember(7);
    fx.pathSpheres.push({ distPc: 2, radiusPc: 1 });
    fx.cluster.update(fx.camera, fx.frame);
    const spheres: MemberSphere[] = [];
    fx.cluster.collectSpheres(fx.camera, spheres);
    expect(spheres).toHaveLength(2);
    expect(spheres[1]).toEqual({ distPc: 2, radiusPc: 1 });
  });
});
