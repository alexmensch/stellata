// The solar-system LocalCluster: per-frame membership + bracket spheres
// for the local depth pass. See ../local-depth/README.md § Cluster API.

import * as THREE from 'three';
import type { LocalCluster } from '../local-depth/local-depth-pass';
import type { MemberSphere } from '../local-depth/slice-pure';
import type { StarLocalMirror } from '../star-pipeline/star-local-mirror';
import { KM_PC } from '../util/astronomy-constants';
import { isHostLocallyActive, ringExtentRadiusPc } from './local-cluster-pure';
import type { OrbitRingsLayer } from './orbit-rings-layer';
import type { PlanetBodyField } from './planet-body-field';
import type { PlanetMeshLayer } from './planet-mesh-layer';

/**
 * Owns the "is a system locally active" decision each frame. Active =
 * any attached host inside its cull distance, or its orbit rings
 * drawing (rings outlive the body cull at far framings). While active,
 * the host's planet slots and its star collapse in the main pass and
 * render through the pass's mirror draws instead; while inactive every
 * body renders in the main pass exactly as before the pass existed.
 */
export class SolarSystemCluster implements LocalCluster {
  readonly group: THREE.Group;

  private readonly field: PlanetBodyField;
  private readonly meshLayer: PlanetMeshLayer;
  private readonly orbitRings: OrbitRingsLayer;
  private readonly starMirror: StarLocalMirror;
  private readonly localMemberIdxUniform: { value: number };
  private readonly spheres: MemberSphere[] = [];
  private readonly tmpBody = new THREE.Vector3();
  private readonly memberScratch: number[] = [];

  constructor(
    field: PlanetBodyField,
    meshLayer: PlanetMeshLayer,
    orbitRings: OrbitRingsLayer,
    starMirror: StarLocalMirror,
    localMemberIdxUniform: { value: number },
  ) {
    this.field = field;
    this.meshLayer = meshLayer;
    this.orbitRings = orbitRings;
    this.starMirror = starMirror;
    this.localMemberIdxUniform = localMemberIdxUniform;
    this.group = new THREE.Group();
    this.group.name = 'solar-system-cluster';
    this.group.add(meshLayer.group);
    this.group.add(orbitRings.group);
    this.group.add(field.localGroup);
    this.group.add(starMirror.group);
  }

  /** Runs in the scene-layer registry AFTER the field + rings updates
   *  (their per-frame state feeds the activation decision) and BEFORE
   *  the main render (the suppression uniforms it writes gate that
   *  render). */
  update(camera: THREE.PerspectiveCamera): void {
    this.spheres.length = 0;
    this.memberScratch.length = 0;

    // Chart mode inks every body as a flat main-pass disc; suppression
    // and mirrors must stay out of the way entirely.
    const fieldLive = this.field.group.visible && !this.field.monochrome;
    let active = false;
    if (fieldLive) {
      const ringsUp = this.orbitRings.anyOrbitRingVisible();
      for (const host of this.field.attachedHosts()) {
        const dHost = camera.position.distanceTo(host.hostLocalPos);
        if (!isHostLocallyActive(dHost, host.cullDistance, ringsUp)) continue;

        // v1: one active host (Sol is the only attached host). The
        // single suppression range + member star generalise to a list
        // when bk5 attaches more hosts.
        active = true;
        this.field.setLocalPassRange(host.startInstance, host.count);
        this.memberScratch.push(host.hostStarIdx);
        this.localMemberIdxUniform.value = host.hostStarIdx;

        this.spheres.push({ distPc: dHost, radiusPc: host.hostRadiusPc });
        for (let i = 0; i < host.count; i++) {
          const flat = host.startInstance + i;
          const planet = this.field.planetAt(flat);
          if (!planet || !this.field.planetLocalPositionInto(flat, this.tmpBody)) continue;
          this.spheres.push({
            distPc: this.tmpBody.distanceTo(camera.position),
            radiusPc: planet.radiusKm * KM_PC,
          });
        }
        if (ringsUp) {
          this.spheres.push({
            distPc: dHost,
            radiusPc: ringExtentRadiusPc(host.ps.planets),
          });
        }
        break;
      }
    }

    if (!active) {
      this.field.setLocalPassRange(-1, 0);
      this.localMemberIdxUniform.value = -1;
    }
    this.starMirror.setMembers(this.memberScratch);
    this.starMirror.sync();
    this.meshLayer.collectSpheres(camera, this.spheres);
  }

  /** Replays the spheres `update()` computed this frame — the scene-
   *  layer registry runs `update()` before `localDepthPass.render`, so
   *  the list is current. Not self-sufficient: never call standalone. */
  collectSpheres(_camera: THREE.PerspectiveCamera, out: MemberSphere[]): void {
    for (const s of this.spheres) out.push(s);
  }

  dispose(): void {
    this.starMirror.dispose();
  }
}
