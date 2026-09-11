// The per-frame view frustum a gated layer tests its bounding volume
// against. See README.md § Declaring what a layer can put on screen.

import * as THREE from 'three';

export class FrameFrustum {
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private valid = false;

  /** Rebuild from the camera's CURRENT pose — the shell calls this once
   *  the frame's last camera write has landed, never before. */
  refresh(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    this.valid = true;
  }

  invalidate(): void {
    this.valid = false;
  }

  get isValid(): boolean {
    return this.valid;
  }

  /** Throws while stale: a layer registered ABOVE the frame's last camera
   *  write would otherwise cull against a pose the frame does not render. */
  intersectsSphere(sphere: THREE.Sphere): boolean {
    if (!this.valid) {
      throw new Error(
        'FrameFrustum read before this frame\'s last camera write — '
        + 'a frustum test is admissible only on layers registered below the orbit lock',
      );
    }
    return this.frustum.intersectsSphere(sphere);
  }
}
