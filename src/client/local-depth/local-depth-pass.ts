// Bracketed second render pass for close-range inter-body occlusion.
// Contract + design in README.md.

import * as THREE from 'three';
import type { StellataRenderer } from '../webgpu/seam';
import {
  computeBracket,
  computeDepthSlices,
  type DepthSlice,
  type MemberSphere,
} from './bracket/slice-pure';

/** K = 1 is a claim about float32 depth STORAGE, not about reversed-z:
 *  one bracket spanning probe→Neptune is only safe on a Depth32Float
 *  attachment. The flag stands in for it because the two are welded
 *  together at boot — `boot-webgpu` refuses a renderer that dropped it
 *  and `WebGpuHdrPipeline` requests Depth32Float behind it. Reversed-z
 *  over FIXED-POINT depth would take this branch and put the bracket
 *  ~262 AU out at Neptune's ring (bracket/README.md § Precision
 *  analysis), so a future backend must re-establish the pairing, not
 *  just set the flag. */
function rendersFloat32Depth(renderer: StellataRenderer): boolean {
  return 'reversedDepthBuffer' in renderer && renderer.reversedDepthBuffer === true;
}

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

  /** Debug-scoped (frame-cost `emptyPass` row): extra `clearDepth()`
   *  calls issued before the slices. On WebGPU each is a whole empty
   *  render pass over the bound target, so pricing one pins the
   *  per-pass floor. Never non-zero outside a measurement dwell. */
  extraEmptyPasses = 0;

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
   *  between slices. Reversed-z Depth32Float (`reversedDepthBuffer`,
   *  the WebGPU boot) is ratio-free, so that path renders the whole
   *  bracket as one slice — bracket/README.md § Decision. No-op when no
   *  cluster reports members, save for `extraEmptyPasses`, which issue
   *  whatever the clusters report. Restores camera near/far and renderer
   *  autoClear before returning. */
  render(renderer: StellataRenderer, camera: THREE.PerspectiveCamera): void {
    if (!this.enabled) return;
    for (let i = 0; i < this.extraEmptyPasses; i++) renderer.clearDepth();
    this.spheres.length = 0;
    for (const cluster of this.clusters) {
      cluster.collectSpheres(camera, this.spheres);
    }
    if (this.spheres.length === 0) return;

    let slices: readonly DepthSlice[];
    if (rendersFloat32Depth(renderer)) {
      const bracket = computeBracket(this.spheres);
      slices = bracket === null ? [] : [bracket];
    } else {
      const viewportH = renderer.getSize(this.tmpSize).y;
      slices = computeDepthSlices(
        this.spheres,
        THREE.MathUtils.degToRad(camera.fov),
        viewportH,
      );
    }
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
