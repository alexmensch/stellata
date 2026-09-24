import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { fakeChromeLineMaterials } from '../chrome-lines/chrome-lines-mock';
import { makeCadenceCtx, makeFrameCtx } from '../scene/frame-ctx-mock';
import { OccluderSet } from '../occlusion/occluder-set';
import type { CadenceReport } from '../render-gate/cadence/clock-cadence-pure';
import { OrbitRingsLayer } from './ephemerides/orbit-rings-layer';
import type { PlanetSystem } from './planet-system';
import type { PlanetBodyField } from './planets/planet-body-field';
import type { PlanetMeshLayer } from './planets/planet-mesh-layer';
import type { ProbeField } from './probes/probe-field';
import type { ProbePathLayer } from './probes/probe-path-layer';
import { SolarSystemWiring } from './solar-system-wiring';

const HOST = 7;
const HOST_LOCAL = new THREE.Vector3(1, 2, 3);
const SOL_INDEX = 4;
const T = 1234;
const PLANET_REPORT: CadenceReport = {
  screenPxPerSimS: 5, fluxFracPerSimS: 0.25, observedPx: 2, observedFluxFrac: 0.5,
};

interface Rig {
  wiring: SolarSystemWiring;
  ringUpdates: unknown[][];
  setPlanetSystemCalls: unknown[][];
  ringsDisposed: number;
  offCalls: number;
  emitPlanetSystem: (ps: PlanetSystem | null) => void;
  state: { ps: PlanetSystem | null; hostKnown: boolean; anchor: number | null; meshWork: boolean };
}

function rig(): Rig {
  const r = {
    ringUpdates: [] as unknown[][],
    setPlanetSystemCalls: [] as unknown[][],
    ringsDisposed: 0,
    offCalls: 0,
    state: { ps: null as PlanetSystem | null, hostKnown: true, anchor: null as number | null, meshWork: false },
  } as Rig;
  let handler: ((ps: PlanetSystem | null) => void) | null = null;
  vi.spyOn(OrbitRingsLayer.prototype, 'update')
    .mockImplementation((...args: unknown[]) => { r.ringUpdates.push(args); });
  vi.spyOn(OrbitRingsLayer.prototype, 'setPlanetSystem')
    .mockImplementation((...args: unknown[]) => { r.setPlanetSystemCalls.push(args); });
  vi.spyOn(OrbitRingsLayer.prototype, 'dispose')
    .mockImplementation(() => { r.ringsDisposed++; });
  const field = {
    localGroup: new THREE.Group(),
    cadenceReport: () => PLANET_REPORT,
    getHostLocalPositionInto: (h: number, out: THREE.Vector3) => {
      if (h !== HOST || !r.state.hostKnown) return false;
      out.copy(HOST_LOCAL);
      return true;
    },
    getHostLocalPositions: (h: number) =>
      (h === HOST ? new Float64Array([0.5, 0, 0, 0, 0.25, 0]) : null),
    planetIdxWithin: (h: number, flat: number | null) =>
      (h === HOST && flat !== null ? flat - 100 : null),
    instanceIndexOf: (h: number, p: number) => (h === HOST ? p + 100 : null),
    planetHostRelPositionInto: (flat: number, out: THREE.Vector3) => {
      out.set(flat, 0, 0);
      return true;
    },
  } as unknown as PlanetBodyField;
  const planetMesh = {
    group: new THREE.Group(),
    anyMeshWorkPending: () => r.state.meshWork,
    setContributing: () => {},
    update: () => {},
  } as unknown as PlanetMeshLayer;
  r.wiring = new SolarSystemWiring({
    chromeLines: fakeChromeLineMaterials(),
    planetField: field,
    planetMesh,
    probeField: { localGroup: new THREE.Group() } as unknown as ProbeField,
    probeTrails: { localGroup: new THREE.Group() } as unknown as ProbePathLayer,
    starCluster: { setHostMember: () => {} },
    occluders: new OccluderSet(),
    solIndex: SOL_INDEX,
    getT: () => T,
    focusedPlanetSystem: () => r.state.ps,
    observeAnchorPlanet: () => r.state.anchor,
    onPlanetSystem: (h) => {
      handler = h;
      return () => { r.offCalls++; };
    },
  });
  r.emitPlanetSystem = (ps) => handler?.(ps);
  return r;
}

const SYSTEM = { hostStarIdx: HOST, planets: [] } as unknown as PlanetSystem;

describe('SolarSystemWiring', () => {
  const camera = new THREE.PerspectiveCamera();

  beforeEach(() => { vi.stubGlobal('window', { innerHeight: 600 }); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hands every planetSystem change to the orbit rings at the live clock', () => {
    const r = rig();
    r.emitPlanetSystem(SYSTEM);
    r.emitPlanetSystem(null);
    expect(r.setPlanetSystemCalls).toEqual([[SYSTEM, SOL_INDEX, T], [null, SOL_INDEX, T]]);
  });

  it('disposing the rings entry unsubscribes and disposes the rings once', () => {
    const r = rig();
    r.wiring.orbitRingsEntry.dispose();
    expect(r.offCalls).toBe(1);
    expect(r.ringsDisposed).toBe(1);
  });

  it('declares the planet field rate on all three entries', () => {
    const r = rig();
    const cc = makeCadenceCtx(camera);
    expect(r.wiring.planetRate(cc)).toBe(PLANET_REPORT);
    for (const entry of [
      r.wiring.orbitRingsEntry, r.wiring.planetMeshEntry, r.wiring.clusterEntry,
    ]) {
      expect(entry.timeBehaviour.kind).toBe('clock');
      if (entry.timeBehaviour.kind === 'clock') {
        expect(entry.timeBehaviour.rate(cc)).toBe(PLANET_REPORT);
      }
    }
  });

  it('feeds the rings no host and no anchor while no system is focused', () => {
    const r = rig();
    r.wiring.orbitRingsEntry.update!(makeFrameCtx(camera, { t: T }));
    const [cam, height, hostPos, t, anchorRing, parentRelInto] = r.ringUpdates[0];
    expect([cam, height, hostPos, t, anchorRing]).toEqual([camera, 600, null, T, null]);
    expect((parentRelInto as (i: number, o: THREE.Vector3) => boolean)(0, new THREE.Vector3()))
      .toBe(false);
  });

  it('feeds the rings the host position, the anchor ring and parent-relative moons', () => {
    const r = rig();
    r.state.ps = SYSTEM;
    r.state.anchor = 103;
    r.wiring.orbitRingsEntry.update!(makeFrameCtx(camera));
    const [, , hostPos, , anchorRing, parentRelInto] = r.ringUpdates[0];
    expect((hostPos as THREE.Vector3).toArray()).toEqual(HOST_LOCAL.toArray());
    expect(anchorRing).toBe(3);
    const out = new THREE.Vector3();
    expect((parentRelInto as (i: number, o: THREE.Vector3) => boolean)(2, out)).toBe(true);
    expect(out.x).toBe(102);
  });

  it('passes a null host position when the host has not landed', () => {
    const r = rig();
    r.state.ps = SYSTEM;
    r.state.hostKnown = false;
    r.wiring.orbitRingsEntry.update!(makeFrameCtx(camera));
    expect(r.ringUpdates[0][2]).toBeNull();
  });

  it('skips the planet mesh for legibility only when no mesh work is pending', () => {
    const r = rig();
    const c = r.wiring.planetMeshEntry.contribution;
    expect(c.kind).toBe('gated');
    if (c.kind !== 'gated') return;
    expect(c.skip(makeFrameCtx(camera))).toBe('legibility');
    r.state.meshWork = true;
    expect(c.skip(makeFrameCtx(camera))).toBeNull();
  });

  it('reports focused body positions in the renderer-local frame', () => {
    const r = rig();
    expect(r.wiring.focusedPlanetLocalPositions()).toBeNull();
    r.state.ps = SYSTEM;
    expect(Array.from(r.wiring.focusedPlanetLocalPositions()!)).toEqual([1.5, 2, 3, 1, 2.25, 3]);
    r.state.hostKnown = false;
    expect(r.wiring.focusedPlanetLocalPositions()).toBeNull();
  });

  it('parents the orbit rings under the local-depth cluster', () => {
    const r = rig();
    expect(r.wiring.cluster.group.children).toContain(r.wiring.orbitRings.group);
  });
});
