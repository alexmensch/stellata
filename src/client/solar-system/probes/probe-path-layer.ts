// One trailing polyline per probe: first ephemeris sample → the probe's
// interpolated position at `t`, never drawn ahead of it. See README.md
// § Trails.

import * as THREE from 'three';
import {
  bakeAnchoredLineVerts,
  isFeatureLegible,
  makeOrbitLine,
  makeOrbitLineMaterial,
  mirrorOrbitLine,
  pixelsPerRadianFromUniforms,
  trackAnchoredLine,
  ORBIT_LINE_OPACITY,
} from '../../util/orbit-line';
import type { ProbeField, ProbeSharedUniforms } from './probe-field';
import { probeSampleIndexAt, type ProbeTrajectory } from './probe-trajectory';

const TRAIL_COLOUR = 0xa8c4dc;
// Just under the marker so a marker sitting on its own trail paints over
// the line rather than being cut by it — in either pass.
const TRAIL_RENDER_ORDER = 3.4;
const TRAIL_LOCAL_RENDER_ORDER = 3.25;

interface Trail {
  readonly traj: ProbeTrajectory;
  /** Sol-relative float64 vertices, xyz-interleaved: samples 0..k then the
   *  interpolated tip. Capacity is the whole trajectory plus that tip. */
  readonly master: Float64Array;
  readonly verts: Float32Array;
  readonly line: THREE.Line;
  /** Local-depth-pass mirror of `line`, sharing its geometry. */
  readonly localLine: THREE.Line;
  readonly bakedAnchor: THREE.Vector3;
  /** Sample index the body is filled to; -1 before the first build. */
  builtIndex: number;
}

/**
 * The traversed segment of each probe's trajectory. The body of the line
 * is the raw trajectory samples and only re-fills when `t` crosses one; the
 * final vertex is rewritten every frame from the field's interpolated
 * position, so the trail ends exactly on the marker at any scrub rate
 * without a rebuild cadence to tune.
 */
export class ProbePathLayer {
  readonly group: THREE.Group;
  /** Local-depth-pass mirror. The solar-system cluster parents this into the
   *  pass scene; exactly one of the two groups is ever visible. */
  readonly localGroup: THREE.Group;
  private material: THREE.LineBasicMaterial;
  private localMaterial: THREE.LineBasicMaterial;
  private trails: Trail[] = [];
  private permitted = true;
  private mono = false;
  private localPassActive = false;
  private shared: ProbeSharedUniforms;
  private solLocal = new THREE.Vector3();

  constructor(shared: ProbeSharedUniforms) {
    this.shared = shared;
    this.group = new THREE.Group();
    this.group.renderOrder = TRAIL_RENDER_ORDER;
    this.group.visible = false;
    this.localGroup = new THREE.Group();
    this.localGroup.renderOrder = TRAIL_LOCAL_RENDER_ORDER;
    this.localGroup.visible = false;
    this.material = makeOrbitLineMaterial(TRAIL_COLOUR, ORBIT_LINE_OPACITY);
    // The local-pass variant strips the log-depth chunks so fragments keep
    // standard bracket depth.
    this.localMaterial = makeOrbitLineMaterial(TRAIL_COLOUR, ORBIT_LINE_OPACITY, true);
  }

  /** Allocate one full-capacity trail per probe, plus its local-pass mirror.
   *  One-shot at load. */
  attach(trajectories: readonly ProbeTrajectory[]): void {
    this.disposeTrails();
    for (const traj of trajectories) {
      const capacity = (traj.sampleT.length + 1) * 3;
      const verts = new Float32Array(capacity);
      const line = makeOrbitLine(verts, this.material, TRAIL_RENDER_ORDER);
      line.geometry.setDrawRange(0, 0);
      (line.geometry.getAttribute('position') as THREE.BufferAttribute)
        .setUsage(THREE.DynamicDrawUsage);
      line.visible = false;
      const localLine = mirrorOrbitLine(line, this.localMaterial, TRAIL_LOCAL_RENDER_ORDER);
      localLine.visible = false;
      this.group.add(line);
      this.localGroup.add(localLine);
      this.trails.push({
        traj,
        master: new Float64Array(capacity),
        verts,
        line,
        localLine,
        bakedAnchor: new THREE.Vector3(),
        builtIndex: -1,
      });
    }
  }

  /**
   * Extend / reposition every trail. Must run AFTER `ProbeField.update`
   * wrote this frame's samples — the tip vertex IS the field's marker
   * position, so a stale read would detach the two.
   *
   * `focusedIdx` is the roster index of the focused probe, or -1: only
   * that probe's trail draws. See README.md § Trails.
   */
  update(
    field: ProbeField,
    t: number,
    camera: THREE.PerspectiveCamera,
    focusedIdx: number,
  ): void {
    if (this.trails.length === 0) {
      this.setDrawn(false);
      return;
    }
    const drawn = this.permitted && !this.mono;
    this.setDrawn(drawn);
    if (!drawn) return;
    field.solLocalInto(this.solLocal);
    const pxPerRad = pixelsPerRadianFromUniforms(this.shared);
    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i];
      const sample = field.sampleFor(i);
      if (i !== focusedIdx || sample === null || !sample.visible) {
        setTrailVisible(trail, false);
        continue;
      }
      // A trail whose span still reads as a line — a probe days after
      // launch traces a fraction of an AU, sub-pixel from anywhere the
      // marker is visible.
      const legible = isFeatureLegible(
        sample.solRelPc.length(), camera.position.distanceTo(sample.localPc), pxPerRad);
      setTrailVisible(trail, legible);
      if (!legible) continue;

      const k = probeSampleIndexAt(trail.traj.sampleT, t);
      const tip = (k + 1) * 3;
      const extended = k !== trail.builtIndex;
      if (extended) {
        trail.master.set(trail.traj.posPc.subarray(0, tip));
        trail.builtIndex = k;
      }
      trail.master[tip] = sample.solRelPc.x;
      trail.master[tip + 1] = sample.solRelPc.y;
      trail.master[tip + 2] = sample.solRelPc.z;
      if (extended) {
        bakeAnchoredLineVerts(trail.master, this.solLocal, trail.verts);
        trail.bakedAnchor.copy(this.solLocal);
        trail.line.position.set(0, 0, 0);
        trail.line.geometry.setDrawRange(0, k + 2);
      } else {
        trackAnchoredLine(trail.line, trail.master, trail.bakedAnchor, this.solLocal);
      }
      trail.verts[tip] = trail.master[tip] + trail.bakedAnchor.x;
      trail.verts[tip + 1] = trail.master[tip + 1] + trail.bakedAnchor.y;
      trail.verts[tip + 2] = trail.master[tip + 2] + trail.bakedAnchor.z;
      (trail.line.geometry.getAttribute('position') as THREE.BufferAttribute)
        .needsUpdate = true;
      // The mirror shares the geometry but not the transform, and
      // trackAnchoredLine writes the anchor drift into `position`.
      trail.localLine.position.copy(trail.line.position);
    }
  }

  /** Route the trails through the local depth pass instead of the main pass
   *  — the marker field's sibling; see its `setLocalPassActive`. */
  setLocalPassActive(on: boolean): void {
    this.localPassActive = on;
    this.setDrawn(this.group.visible || this.localGroup.visible);
  }

  private setDrawn(drawn: boolean): void {
    this.group.visible = drawn && !this.localPassActive;
    this.localGroup.visible = drawn && this.localPassActive;
  }

  /** Whether one probe's trail is drawn this frame — the cluster's gate on
   *  contributing its extent to the depth bracket. */
  trailVisible(idx: number): boolean {
    return this.trails[idx]?.line.visible ?? false;
  }

  setPermitted(on: boolean): void {
    this.permitted = on;
    if (!on) this.setDrawn(false);
  }

  setMonochrome(on: boolean): void {
    this.mono = on;
    if (on) this.setDrawn(false);
  }

  dispose(): void {
    this.disposeTrails();
    this.material.dispose();
    this.localMaterial.dispose();
  }

  private disposeTrails(): void {
    for (const trail of this.trails) {
      this.group.remove(trail.line);
      this.localGroup.remove(trail.localLine);
      trail.line.geometry.dispose();
    }
    this.trails = [];
  }
}

/** Both draws of one trail, in lockstep — the mirror carries no state of its
 *  own beyond `visible` and `position`. */
function setTrailVisible(trail: Trail, on: boolean): void {
  trail.line.visible = on;
  trail.localLine.visible = on;
}
