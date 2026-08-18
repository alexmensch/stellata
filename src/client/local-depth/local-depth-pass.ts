// Bracketed second render pass for close-range inter-body occlusion.
// Contract + design in README.md.

import * as THREE from 'three';
import {
  computeDepthSlices,
  type MemberSphere,
} from './bracket/slice-pure';

export interface LocalCluster {
  /** Root of the cluster's local-pass renderables. Parked in the
   *  pass's scene while registered. */
  readonly group: THREE.Group;
  /** Per-frame: append member bounding spheres (camera-relative pc).
   *  Appending nothing marks the cluster inactive this frame. */
  collectSpheres(camera: THREE.PerspectiveCamera, out: MemberSphere[]): void;
}

export class LocalDepthPass {
  readonly scene = new THREE.Scene();

  /** Debug-scoped kill switch (frame-cost differentials). Disabling the
   *  pass loses close-range occlusion — never ship a code path that
   *  leaves this false outside a measurement dwell. */
  enabled = true;

  private readonly clusters = new Set<LocalCluster>();
  private readonly spheres: MemberSphere[] = [];
  private readonly tmpSize = new THREE.Vector2();

  /** Returns the unregister function; unregistering removes the
   *  cluster's group from the pass scene without reparenting it —
   *  the caller decides where it goes next. */
  register(cluster: LocalCluster): () => void {
    this.clusters.add(cluster);
    this.scene.add(cluster.group);
    return () => {
      this.clusters.delete(cluster);
      this.scene.remove(cluster.group);
    };
  }

  /** Run immediately after the main render. Renders the pass scene
   *  once per depth slice, far→near, clearing depth (never colour)
   *  between slices. No-op when no cluster reports members. Restores
   *  camera near/far and renderer autoClear before returning. */
  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    if (!this.enabled) return;
    this.spheres.length = 0;
    for (const cluster of this.clusters) {
      cluster.collectSpheres(camera, this.spheres);
    }
    if (this.spheres.length === 0) return;

    const viewportH = renderer.getSize(this.tmpSize).y;
    const slices = computeDepthSlices(
      this.spheres,
      THREE.MathUtils.degToRad(camera.fov),
      viewportH,
    );
    const near0 = camera.near;
    const far0 = camera.far;
    const autoClear0 = renderer.autoClear;
    renderer.autoClear = false;
    for (const slice of slices) {
      camera.near = slice.nearPc;
      camera.far = slice.farPc;
      camera.updateProjectionMatrix();
      renderer.clearDepth();
      renderer.render(this.scene, camera);
    }
    camera.near = near0;
    camera.far = far0;
    camera.updateProjectionMatrix();
    renderer.autoClear = autoClear0;
  }

  dispose(): void {
    for (const cluster of this.clusters) {
      this.scene.remove(cluster.group);
    }
    this.clusters.clear();
    this.spheres.length = 0;
  }
}
