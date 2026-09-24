// See README.md § The serialised look pin.

import * as THREE from 'three';
import { lookPinStale, writeLookPin } from './look-pin-pure';

export class ObserveLookPin {
  private readonly pinnedAt = new THREE.Quaternion(Number.NaN, 0, 0, 0);
  private readonly forward = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.Camera,
    private readonly target: THREE.Vector3,
  ) {}

  update(): void {
    if (!lookPinStale(this.pinnedAt, this.camera.quaternion)) return;
    this.pinnedAt.copy(this.camera.quaternion);
    this.forward.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    writeLookPin(this.camera.position, this.forward, this.target);
  }

  /** Force the next `update` to re-derive. Required after anything else
   *  writes `target` — the observe transitions do. */
  invalidate(): void {
    this.pinnedAt.set(Number.NaN, 0, 0, 0);
  }
}
