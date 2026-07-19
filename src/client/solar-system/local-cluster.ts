// The solar-system LocalCluster: per-frame membership + bracket spheres
// for the local depth pass. See ../local-depth/README.md § Cluster API.

import * as THREE from 'three';
import type { LocalCluster } from '../local-depth/local-depth-pass';
import type { MemberSphere } from '../local-depth/slice-pure';
import { KM_PC } from '../util/astronomy-constants';
import {
  isHostLocallyActive,
  moonRingExtentsPc,
  ringExtentRadiusPc,
} from './local-cluster-pure';
import type { OrbitRingsLayer } from './orbit-rings-layer';
import type { PlanetBodyField } from './planet-body-field';
import type { PlanetMeshLayer } from './planet-mesh-layer';

/** The seam to the star cluster: the active host's star mirrors there
 *  (full membership — the host's billboard renders in the pass with its
 *  bodies), so this cluster only reports which star that is. */
export interface HostStarMemberSink {
  setHostMember(idx: number | null): void;
}

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
  private readonly starCluster: HostStarMemberSink;
  private readonly spheres: MemberSphere[] = [];
  private readonly tmpBody = new THREE.Vector3();

  constructor(
    field: PlanetBodyField,
    meshLayer: PlanetMeshLayer,
    orbitRings: OrbitRingsLayer,
    starCluster: HostStarMemberSink,
  ) {
    this.field = field;
    this.meshLayer = meshLayer;
    this.orbitRings = orbitRings;
    this.starCluster = starCluster;
    this.group = new THREE.Group();
    this.group.name = 'solar-system-cluster';
    this.group.add(meshLayer.group);
    this.group.add(orbitRings.group);
    this.group.add(field.localGroup);
  }

  /** Runs in the scene-layer registry AFTER the field + rings updates
   *  (their per-frame state feeds the activation decision) and BEFORE
   *  the main render (the suppression uniforms it writes gate that
   *  render). */
  update(camera: THREE.PerspectiveCamera): void {
    this.spheres.length = 0;

    // Chart mode inks every body as a flat main-pass disc; suppression
    // and mirrors must stay out of the way entirely.
    const fieldLive = this.field.group.visible && !this.field.monochrome;
    let hostMember: number | null = null;
    if (fieldLive) {
      const ringsUp = this.orbitRings.anyOrbitRingVisible();
      for (const host of this.field.attachedHosts()) {
        const dHost = camera.position.distanceTo(host.hostLocalPos);
        if (!isHostLocallyActive(dHost, host.cullDistance, ringsUp)) continue;

        // v1: one active host (Sol is the only attached host). The
        // single suppression range + member star generalise to a list
        // when bk5 attaches more hosts.
        this.field.setLocalPassRange(host.startInstance, host.count);
        hostMember = host.hostStarIdx;

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
          for (const [parentIdx, radiusPc] of moonRingExtentsPc(host.ps.planets)) {
            const flat = host.startInstance + parentIdx;
            if (!this.field.planetLocalPositionInto(flat, this.tmpBody)) continue;
            this.spheres.push({
              distPc: this.tmpBody.distanceTo(camera.position),
              radiusPc,
            });
          }
        }
        break;
      }
    }

    if (hostMember === null) this.field.setLocalPassRange(-1, 0);
    this.starCluster.setHostMember(hostMember);
    this.meshLayer.collectSpheres(camera, this.spheres);
  }

  /** Replays the spheres `update()` computed this frame — the scene-
   *  layer registry runs `update()` before `localDepthPass.render`, so
   *  the list is current. Not self-sufficient: never call standalone. */
  collectSpheres(_camera: THREE.PerspectiveCamera, out: MemberSphere[]): void {
    for (const s of this.spheres) out.push(s);
  }
}
