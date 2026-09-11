import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MemberSphere } from '../local-depth/bracket/slice-pure';
import type { OrbitRingsLayer } from './ephemerides/orbit-rings-layer';
import type { PlanetBodyField } from './planets/planet-body-field';
import type { PlanetMeshLayer } from './planets/planet-mesh-layer';
import type { ProbeField } from './probes/probe-field';
import type { ProbePathLayer } from './probes/probe-path-layer';
import { OccluderSet } from '../occlusion/occluder-set';
import { AU_PC, KM_PC } from '../util/astronomy-constants';
import { SOL_PLANETS } from './planet-system';
import { polarRadiusRatio } from './planets/spheroid-pure';
import { SolarSystemCluster } from './local-cluster';

const HOST_START = 3;
const HOST_COUNT = 5;
/** Camera at the origin, Earth 1 AU down −z with the Moon behind it. */
const EARTH_D_PC = AU_PC;
const MOON_A_PC = 384400 * KM_PC;

interface Fixture {
  cluster: SolarSystemCluster;
  camera: THREE.PerspectiveCamera;
  /** (start, count) the field was last told to suppress. */
  range: [number, number];
  localPassActive: boolean[];
  hostMember: (number | null)[];
  occluders: OccluderSet;
}

interface FixtureOpts {
  monochrome?: boolean;
  /** Bodies the field reports, as (flat offset from HOST_START, radius
   *  km, local position). An empty list keeps the field body-less.
   *  `meshUp` stands for the body being inside the crossfade band, where
   *  the flattened mesh is what draws. */
  bodies?: {
    offset: number;
    radiusKm: number;
    pos: THREE.Vector3;
    flattening?: number;
    meshUp?: boolean;
  }[];
  hiddenInstanceIdx?: number;
}

function makeFixture(opts: FixtureOpts = {}): Fixture {
  const { monochrome = false, bodies = [], hiddenInstanceIdx = -1 } = opts;
  const byFlat = new Map(bodies.map((b) => [HOST_START + b.offset, b]));
  const occluders = new OccluderSet();
  const f: Partial<Fixture> = {
    range: [-99, -99],
    localPassActive: [],
    hostMember: [],
    occluders,
  };
  const field = {
    group: { visible: true },
    monochrome,
    hiddenInstanceIdx,
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
    planetAt: (flat: number) => byFlat.get(flat) ?? null,
    planetLocalPositionInto: (flat: number, out: THREE.Vector3) => {
      const b = byFlat.get(flat);
      if (!b) return false;
      out.copy(b.pos);
      return true;
    },
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
    {
      group: new THREE.Group(),
      collectSpheres: () => {},
      drawnPoleInto: (flat: number, out: THREE.Vector3) => {
        if (!byFlat.get(flat)?.meshUp) return false;
        out.set(0, 1, 0);
        return true;
      },
    } as unknown as PlanetMeshLayer,
    { group: new THREE.Group(), anyOrbitRingVisible: () => false } as unknown as OrbitRingsLayer,
    probeField,
    {
      localGroup: new THREE.Group(),
      setLocalPassActive: () => {},
      trailVisible: () => false,
    } as unknown as ProbePathLayer,
    { setHostMember: (idx: number | null) => f.hostMember!.push(idx) },
    occluders,
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
    const f = makeFixture({ monochrome: true });
    f.cluster.update(f.camera);

    expect(f.range).toEqual([-1, 0]);
    expect(f.localPassActive).toEqual([false]);
    expect(f.hostMember).toEqual([null]);
  });

  it('reports no bracket spheres while parked', () => {
    const f = makeFixture({ monochrome: true });
    f.cluster.update(f.camera);

    const out: MemberSphere[] = [];
    f.cluster.collectSpheres(f.camera, out);
    expect(out).toEqual([]);
  });
});

describe('SolarSystemCluster occluder publish', () => {
  const EARTH = { offset: 0, radiusKm: 6371, pos: new THREE.Vector3(0, 0, -EARTH_D_PC) };
  const MOON = {
    offset: 1,
    radiusKm: 1737.4,
    pos: new THREE.Vector3(0, 0, -(EARTH_D_PC + MOON_A_PC)),
  };

  it('publishes one occluder per body the field reports', () => {
    const f = makeFixture({ bodies: [EARTH, MOON] });
    f.cluster.update(f.camera);
    expect(f.occluders.count).toBe(2);
  });

  it('hides an anchor the far body sits behind', () => {
    const f = makeFixture({ bodies: [EARTH, MOON] });
    f.cluster.update(f.camera);
    expect(f.occluders.hides(MOON.pos, f.camera.position)).toBe(true);
    expect(f.occluders.hides(EARTH.pos, f.camera.position)).toBe(false);
  });

  it('leaves the observe-anchor body out — it draws nothing', () => {
    const f = makeFixture({ bodies: [EARTH, MOON], hiddenInstanceIdx: HOST_START });
    f.cluster.update(f.camera);
    expect(f.occluders.count).toBe(1);
    expect(f.occluders.hides(MOON.pos, f.camera.position)).toBe(false);
  });

  it('publishes nothing while parked in chart mode', () => {
    const f = makeFixture({ monochrome: true, bodies: [EARTH, MOON] });
    f.cluster.update(f.camera);
    expect(f.occluders.count).toBe(0);
  });

  // Saturn as the table actually ships it, so a change to either the row
  // or to polarRadiusRatio moves this test rather than passing regardless.
  // The camera sits at the origin at the planet-focus zoom floor (~2.4
  // equatorial radii); the fixture's mesh stub reports the pole as +Y.
  const SATURN_ROW = SOL_PLANETS.find((p) => p.name === 'Saturn')!;
  const SAT_R_PC = SATURN_ROW.radiusKm * KM_PC;
  const SAT_D_PC = 2.4 * SAT_R_PC;
  const saturn = (meshUp: boolean) => ({
    offset: 0,
    radiusKm: SATURN_ROW.radiusKm,
    flattening: SATURN_ROW.flattening,
    pos: new THREE.Vector3(0, 0, -SAT_D_PC),
    meshUp,
  });

  /** The angle off the body-centre direction at which the DRAWN limb sits,
   *  toward the pole and across it. What a mask covers is an angle, not a
   *  distance at the body's own depth — the cone widens with range. */
  const limbRad = (ratio: number): number =>
    Math.atan(Math.tan(Math.asin(SAT_R_PC / SAT_D_PC)) * ratio);
  /** An anchor well beyond Saturn, `theta` radians off its centre
   *  direction, toward the pole. */
  const overSaturnPole = (theta: number) => new THREE.Vector3(
    0, 100 * SAT_R_PC * Math.sin(theta), -100 * SAT_R_PC * Math.cos(theta),
  );

  it('masks a flattened body at the limb its mesh draws', () => {
    // Between the polar limb and the equatorial one is open sky. At this
    // framing the gap is ~2°, tens of pixels deep.
    const f = makeFixture({ bodies: [saturn(true)] });
    f.cluster.update(f.camera);
    const mid = 0.5 * (limbRad(polarRadiusRatio(SATURN_ROW)) + limbRad(1));
    expect(f.occluders.hides(overSaturnPole(mid), f.camera.position)).toBe(false);
    expect(f.occluders.hides(overSaturnPole(0), f.camera.position)).toBe(true);
  });

  it('takes its polar ratio from the source the mesh scales by', () => {
    // The contract, not a number: the verdict flips either side of the
    // limb polarRadiusRatio defines, so a publish that re-derived
    // 1 - flattening, or dropped the flattening, fails here.
    const f = makeFixture({ bodies: [saturn(true)] });
    f.cluster.update(f.camera);
    const drawn = limbRad(polarRadiusRatio(SATURN_ROW));
    expect(f.occluders.hides(overSaturnPole(drawn * 0.98), f.camera.position))
      .toBe(true);
    expect(f.occluders.hides(overSaturnPole(drawn * 1.02), f.camera.position))
      .toBe(false);
  });

  it('publishes a round body below the crossfade band', () => {
    // No mesh there — only the round additive glare billboard draws, so a
    // round mask IS what is on screen.
    const f = makeFixture({ bodies: [saturn(false)] });
    f.cluster.update(f.camera);
    const mid = 0.5 * (limbRad(polarRadiusRatio(SATURN_ROW)) + limbRad(1));
    expect(f.occluders.hides(overSaturnPole(mid), f.camera.position)).toBe(true);
  });

  it('keeps the ring-extent spheres out of the occluder set', () => {
    // The bracket takes system-wide ring extents; one of those as an
    // occluder would blank every label inside an orbit's radius.
    const f = makeFixture({ bodies: [EARTH, MOON] });
    f.cluster.update(f.camera);

    const spheres: MemberSphere[] = [];
    f.cluster.collectSpheres(f.camera, spheres);
    expect(spheres.length).toBeGreaterThanOrEqual(f.occluders.count);
  });
});
