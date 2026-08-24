// The solar-system LocalCluster: per-frame membership + bracket spheres
// for the local depth pass. See ../local-depth/README.md § Cluster API.

import * as THREE from 'three';
import type { LocalCluster } from '../local-depth/local-depth-pass';
import type { MemberSphere } from '../local-depth/bracket/slice-pure';
import { KM_PC } from '../util/astronomy-constants';
import {
  isHostLocallyActive,
  moonRingExtentsPc,
  ringExtentRadiusPc,
} from './local-cluster-pure';
import type { OrbitRingsLayer } from './ephemerides/orbit-rings-layer';
import type { PlanetBodyField } from './planets/planet-body-field';
import type { PlanetMeshLayer } from './planets/planet-mesh-layer';
import type { ProbeField } from './probes/probe-field';
import type { ProbePathLayer } from './probes/probe-path-layer';

/** The seam to the star cluster: the active host's star mirrors there
 *  (full membership — the host's billboard renders in the pass with its
 *  bodies), so this cluster only reports which star that is. */
export interface HostStarMemberSink {
  setHostMember(idx: number | null): void;
}

export interface SolarSystemClusterFrame {
  /** Whether the local depth pass renders this boot. False on WebGPU
   *  until its port child: the bodies' main-pass draws collapse expecting
   *  the mirror repaint, so with no pass every planet glare and probe
   *  marker of the active host would simply vanish. The star sibling
   *  parks on the same flag (`StarLocalClusterFrame.localPassLive`). */
  localPassLive: boolean;
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
  private readonly probeField: ProbeField;
  private readonly probeTrails: ProbePathLayer;
  private readonly starCluster: HostStarMemberSink;
  private readonly spheres: MemberSphere[] = [];
  private readonly tmpBody = new THREE.Vector3();
  private readonly tmpSol = new THREE.Vector3();

  constructor(
    field: PlanetBodyField,
    meshLayer: PlanetMeshLayer,
    orbitRings: OrbitRingsLayer,
    probeField: ProbeField,
    probeTrails: ProbePathLayer,
    starCluster: HostStarMemberSink,
  ) {
    this.field = field;
    this.meshLayer = meshLayer;
    this.orbitRings = orbitRings;
    this.probeField = probeField;
    this.probeTrails = probeTrails;
    this.starCluster = starCluster;
    this.group = new THREE.Group();
    this.group.name = 'solar-system-cluster';
    this.group.add(meshLayer.group);
    this.group.add(orbitRings.group);
    this.group.add(field.localGroup);
    this.group.add(probeField.localGroup);
    this.group.add(probeTrails.localGroup);
  }

  /** Runs in the scene-layer registry AFTER the field + rings updates
   *  (their per-frame state feeds the activation decision) and BEFORE
   *  the main render (the suppression uniforms it writes gate that
   *  render). */
  update(camera: THREE.PerspectiveCamera, frame: SolarSystemClusterFrame): void {
    this.spheres.length = 0;

    // Chart mode inks every body as a flat main-pass disc; suppression
    // and mirrors must stay out of the way entirely. Same park while the
    // local depth pass is not rendering (the WebGPU boot, until its port
    // child): a collapse whose mirror never repaints is a body that
    // simply does not draw.
    const fieldLive = this.field.group.visible && !this.field.monochrome
      && frame.localPassLive;
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
    this.collectProbes(camera, hostMember !== null);
  }

  /**
   * Probe markers and trails follow the bodies between passes. A metre-scale
   * glyph has no radius of its own, so a marker contributes only its distance;
   * a trail spans Sol to the probe, so it contributes a Sol-centred sphere of
   * the probe's heliocentric radius. Voyager 1 at 167 AU widens the bracket
   * to 8e13 — still four slices at the default `maxSliceRatio`, the same count
   * the planet members already need (../local-depth/README.md § Depth slices).
   */
  private collectProbes(camera: THREE.PerspectiveCamera, active: boolean): void {
    this.probeField.setLocalPassActive(active);
    this.probeTrails.setLocalPassActive(active);
    if (!active) return;
    this.probeField.solLocalInto(this.tmpSol);
    const dSol = this.tmpSol.distanceTo(camera.position);
    for (let i = 0; i < this.probeField.probeCount(); i++) {
      const s = this.probeField.sampleFor(i);
      if (s === null || !s.visible) continue;
      this.spheres.push({ distPc: s.localPc.distanceTo(camera.position), radiusPc: 0 });
      if (this.probeTrails.trailVisible(i)) {
        this.spheres.push({ distPc: dSol, radiusPc: s.solRelPc.length() });
      }
    }
  }

  /** Replays the spheres `update()` computed this frame — the scene-
   *  layer registry runs `update()` before `localDepthPass.render`, so
   *  the list is current. Not self-sufficient: never call standalone. */
  collectSpheres(_camera: THREE.PerspectiveCamera, out: MemberSphere[]): void {
    for (const s of this.spheres) out.push(s);
  }
}
