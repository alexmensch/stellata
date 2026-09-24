// Solar-system scene wiring — see README.md § Wiring.

import * as THREE from 'three';
import type { ChromeLineMaterials } from '../chrome-lines/chrome-line-materials';
import type { OccluderSet } from '../occlusion/occluder-set';
import type { CadenceReport } from '../render-gate/cadence/clock-cadence-pure';
import type { CadenceCtx, SceneLayer } from '../scene/scene-layer';
import { OrbitRingsLayer } from './ephemerides/orbit-rings-layer';
import { type HostStarMemberSink, SolarSystemCluster } from './local-cluster';
import type { PlanetSystem } from './planet-system';
import type { PlanetBodyField } from './planets/planet-body-field';
import type { PlanetMeshLayer } from './planets/planet-mesh-layer';
import type { ProbeField } from './probes/probe-field';
import type { ProbePathLayer } from './probes/probe-path-layer';

export interface SolarSystemWiringDeps {
  chromeLines: ChromeLineMaterials;
  planetField: PlanetBodyField;
  planetMesh: PlanetMeshLayer;
  probeField: ProbeField;
  probeTrails: ProbePathLayer;
  starCluster: HostStarMemberSink;
  occluders: OccluderSet;
  solIndex: number;
  getT: () => number;
  focusedPlanetSystem: () => PlanetSystem | null;
  /** The planet OBSERVE stands on, as a flat body-field instance index. */
  observeAnchorPlanet: () => number | null;
  onPlanetSystem: (handler: (ps: PlanetSystem | null) => void) => () => void;
}

export class SolarSystemWiring {
  readonly orbitRings: OrbitRingsLayer;
  readonly cluster: SolarSystemCluster;
  readonly planetRate: (cc: CadenceCtx) => CadenceReport;
  readonly orbitRingsEntry: SceneLayer;
  readonly planetMeshEntry: SceneLayer;
  readonly clusterEntry: SceneLayer;

  private readonly field: PlanetBodyField;
  private readonly focusedPlanetSystem: () => PlanetSystem | null;
  private readonly tmpHostLocal = new THREE.Vector3();

  constructor(deps: SolarSystemWiringDeps) {
    const { planetField: field, planetMesh } = deps;
    const orbitRings = new OrbitRingsLayer(deps.chromeLines);
    this.field = field;
    this.focusedPlanetSystem = deps.focusedPlanetSystem;
    this.orbitRings = orbitRings;
    this.cluster = new SolarSystemCluster({
      field,
      meshLayer: planetMesh,
      orbitRings,
      probeField: deps.probeField,
      probeTrails: deps.probeTrails,
      starCluster: deps.starCluster,
      occluders: deps.occluders,
    });
    this.planetRate = (cc) => field.cadenceReport(cc);
    const offPlanetSystem = deps.onPlanetSystem((ps) => {
      orbitRings.setPlanetSystem(ps, deps.solIndex, deps.getT());
    });

    this.orbitRingsEntry = {
      timeBehaviour: { kind: 'clock', rate: this.planetRate },
      contribution: { kind: 'always' },
      update: (ctx) => {
        const ps = deps.focusedPlanetSystem();
        const hostPos = ps !== null
          && field.getHostLocalPositionInto(ps.hostStarIdx, this.tmpHostLocal)
          ? this.tmpHostLocal : null;
        orbitRings.update(
          ctx.camera,
          window.innerHeight,
          hostPos,
          ctx.t,
          ps === null ? null : field.planetIdxWithin(ps.hostStarIdx, deps.observeAnchorPlanet()),
          (planetIdx, out) => {
            if (ps === null) return false;
            const flat = field.instanceIndexOf(ps.hostStarIdx, planetIdx);
            return flat !== null && field.planetHostRelPositionInto(flat, out);
          },
        );
      },
      setMonochrome: (on) => orbitRings.setMonochrome(on),
      dispose: () => {
        offPlanetSystem();
        orbitRings.dispose();
      },
    };
    this.planetMeshEntry = {
      timeBehaviour: { kind: 'clock', rate: this.planetRate },
      contribution: {
        kind: 'gated',
        skip: (ctx) => planetMesh.anyMeshWorkPending(ctx.camera.position) ? null : 'legibility',
        setContributing: (on) => planetMesh.setContributing(on),
      },
      update: (ctx) => planetMesh.update(ctx.camera, ctx.t),
      dispose: () => {},
    };
    this.clusterEntry = {
      timeBehaviour: { kind: 'clock', rate: this.planetRate },
      contribution: { kind: 'always' },
      update: (ctx) => this.cluster.update(ctx.camera),
      dispose: () => {},
    };
  }

  /** Renderer-local positions of the focused host's bodies (xyz triples,
   *  length 3·N), or null if no system is attached. The host offset is
   *  applied — under planet focus the host is not at the local origin. A
   *  fresh copy each call (`PlanetBodyField.getHostLocalPositions`), so safe
   *  to cache across frames. */
  focusedPlanetLocalPositions(): Float64Array | null {
    const ps = this.focusedPlanetSystem();
    if (!ps) return null;
    const rel = this.field.getHostLocalPositions(ps.hostStarIdx);
    if (!rel) return null;
    if (!this.field.getHostLocalPositionInto(ps.hostStarIdx, this.tmpHostLocal)) return null;
    for (let i = 0; i < rel.length; i += 3) {
      rel[i] += this.tmpHostLocal.x;
      rel[i + 1] += this.tmpHostLocal.y;
      rel[i + 2] += this.tmpHostLocal.z;
    }
    return rel;
  }
}
