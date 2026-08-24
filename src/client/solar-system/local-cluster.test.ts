import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MemberSphere } from '../local-depth/bracket/slice-pure';
import type { OrbitRingsLayer } from './ephemerides/orbit-rings-layer';
import type { PlanetBodyField } from './planets/planet-body-field';
import type { PlanetMeshLayer } from './planets/planet-mesh-layer';
import type { ProbeField } from './probes/probe-field';
import type { ProbePathLayer } from './probes/probe-path-layer';
import { SolarSystemCluster } from './local-cluster';

const HOST_START = 3;
const HOST_COUNT = 5;

interface Fixture {
  cluster: SolarSystemCluster;
  camera: THREE.PerspectiveCamera;
  /** (start, count) the field was last told to suppress. */
  range: [number, number];
  localPassActive: boolean[];
  hostMember: (number | null)[];
}

function makeFixture(monochrome = false): Fixture {
  const f: Partial<Fixture> = {
    range: [-99, -99],
    localPassActive: [],
    hostMember: [],
  };
  const field = {
    group: { visible: true },
    monochrome,
    localGroup: new THREE.Group(),
    attachedHosts: () => [{
      hostStarIdx: 0,
      startInstance: HOST_START,
      count: HOST_COUNT,
      hostLocalPos: new THREE.Vector3(),
      hostRadiusPc: 1,
      // The camera sits at the origin with the host, so any positive
      // cull distance makes this host locally active.
      cullDistance: 1,
      ps: { planets: [] },
    }][Symbol.iterator](),
    setLocalPassRange: (start: number, count: number) => {
      f.range = [start, count];
    },
    planetAt: () => null,
    planetLocalPositionInto: () => false,
  } as unknown as PlanetBodyField;

  const probeField = {
    localGroup: new THREE.Group(),
    setLocalPassActive: (on: boolean) => f.localPassActive!.push(on),
    solLocalInto: (out: THREE.Vector3) => out.set(0, 0, 0),
    probeCount: () => 0,
    sampleFor: () => null,
  } as unknown as ProbeField;

  const cluster = new SolarSystemCluster(
    field,
    { group: new THREE.Group(), collectSpheres: () => {} } as unknown as PlanetMeshLayer,
    { group: new THREE.Group(), anyOrbitRingVisible: () => false } as unknown as OrbitRingsLayer,
    probeField,
    {
      localGroup: new THREE.Group(),
      setLocalPassActive: () => {},
      trailVisible: () => false,
    } as unknown as ProbePathLayer,
    { setHostMember: (idx: number | null) => f.hostMember!.push(idx) },
  );

  f.cluster = cluster;
  f.camera = new THREE.PerspectiveCamera();
  return f as Fixture;
}

describe('SolarSystemCluster local-pass routing', () => {
  it('routes an active host into the pass', () => {
    const f = makeFixture();
    f.cluster.update(f.camera);

    expect(f.range).toEqual([HOST_START, HOST_COUNT]);
    expect(f.localPassActive).toEqual([true]);
    expect(f.hostMember).toEqual([0]);
  });

  it('parks the whole hand-off in chart mode', () => {
    // Chart inks every body as a flat main-pass disc; a suppression range
    // there is a planet that renders nowhere at all.
    const f = makeFixture(true);
    f.cluster.update(f.camera);

    expect(f.range).toEqual([-1, 0]);
    expect(f.localPassActive).toEqual([false]);
    expect(f.hostMember).toEqual([null]);
  });

  it('reports no bracket spheres while parked', () => {
    const f = makeFixture(true);
    f.cluster.update(f.camera);

    const out: MemberSphere[] = [];
    f.cluster.collectSpheres(f.camera, out);
    expect(out).toEqual([]);
  });
});
