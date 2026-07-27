// The camera's reference up axis — persistent roll state, galactic north
// by default. See README.md § Reference up axis.

import * as THREE from 'three';
import { GALACTIC_NORTH_POLE_ICRS } from '../../../galactic/galactic-coords';
import {
  cameraLocalUpInto,
  correctUpTowardReference,
  levelUpInto,
  signedAngleAbout,
} from './reference-up-pure';

export class ReferenceUpController {
  private readonly reference = GALACTIC_NORTH_POLE_ICRS.clone();
  // Per-call scratch — reused so the per-frame correction never allocates.
  private readonly forward = new THREE.Vector3();
  private readonly level = new THREE.Vector3();
  private readonly currentUp = new THREE.Vector3();
  private readonly rollQuat = new THREE.Quaternion();

  /** The reference axis. Slerp endpoints capture this rather than
   *  `camera.up`: a `lookAt` resolves both to the same image-plane up, and
   *  only this one is free of the transported roll the endpoint would
   *  otherwise land on. Callers must NOT mutate it — roll goes through
   *  `roll` / `snapReferenceToNorth` / `set`. */
  get(): THREE.Vector3 { return this.reference; }

  /** URL restore. Components are interpreted as a reference axis, which is
   *  what a `lookAt` made of any historic `camera.up` value anyway. */
  set(x: number, y: number, z: number): void {
    if (x === 0 && y === 0 && z === 0) return;
    this.reference.set(x, y, z).normalize();
  }

  /** The camera's view axis, straight off the quaternion — deliberately not
   *  `target − position`. The two agree in steady state, but every camera
   *  animation drives orientation independently of the orbit pivot (warp
   *  points `controls.target` at the destination from launch), and the axis
   *  the user perceives roll about is the one they're looking down. */
  private viewForwardInto(out: THREE.Vector3, camera: THREE.Camera): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(camera.quaternion);
  }

  /** NAVIGATE per-frame step: pull `camera.up` back toward the reference so
   *  orbit holonomy can't accumulate into roll. Must run before
   *  `controls.update()` / any animation tick — every navigate-mode
   *  orientation source reads `camera.up` through `lookAt`. */
  correct(camera: THREE.Camera): number {
    this.viewForwardInto(this.forward, camera);
    return correctUpTowardReference(camera.up, this.forward, this.reference, this.level);
  }

  /** OBSERVE per-frame step: there the quaternion is the roll authority
   *  (direct-manipulation drag rolls by construction), so the reference
   *  follows the camera instead of driving it. Keeps the axis truthful for
   *  URL round-trip and makes the observe→navigate handover a no-op. */
  adoptFromCamera(camera: THREE.Camera): void {
    cameraLocalUpInto(this.reference, camera).normalize();
    camera.up.copy(this.reference);
  }

  /** Explicit roll: re-tilt the reference about the view axis, so the tilt
   *  persists through subsequent orbit / dolly untouched. */
  roll(camera: THREE.Camera, angle: number): void {
    this.viewForwardInto(this.forward, camera);
    this.reference.applyAxisAngle(this.forward, angle).normalize();
    this.correct(camera);
  }

  /** Signed roll from the reference axis to galactic level, about the view
   *  axis — the NAVIGATE residual. Read off the reference rather than the
   *  rendered quaternion because there the quaternion trails `camera.up` by
   *  a frame: `lookAt` hasn't consumed the newest roll yet. */
  referenceRollError(camera: THREE.Camera): number {
    this.viewForwardInto(this.forward, camera);
    if (levelUpInto(this.currentUp, this.reference, this.forward) === 0) return 0;
    return this.rollErrorTowardNorth();
  }

  /** Signed roll from the rendered screen-up to galactic level — the OBSERVE
   *  residual, where the quaternion is what the user sees. */
  renderedRollError(camera: THREE.Camera): number {
    this.viewForwardInto(this.forward, camera);
    cameraLocalUpInto(this.currentUp, camera);
    this.currentUp.addScaledVector(this.forward, -this.currentUp.dot(this.forward));
    if (this.currentUp.lengthSq() === 0) return 0;
    this.currentUp.normalize();
    return this.rollErrorTowardNorth();
  }

  /** Signed angle from `currentUp` (already unit and ⊥ `forward`) to the
   *  galactic-level up for `forward`. */
  private rollErrorTowardNorth(): number {
    if (levelUpInto(this.level, GALACTIC_NORTH_POLE_ICRS, this.forward) === 0) return 0;
    return signedAngleAbout(this.currentUp, this.level, this.forward);
  }

  /** Re-anchor the reference exactly onto galactic north. The snap target is
   *  the canonical reference, never the user's last roll — a view that reads
   *  level from here would otherwise still drift as the orbit moves, since
   *  any axis in the `forward`/north plane renders level from this one
   *  direction. Callers own the threshold (`SNAP_TO_LEVEL_RAD`). */
  snapReferenceToNorth(camera: THREE.Camera): void {
    this.reference.copy(GALACTIC_NORTH_POLE_ICRS);
    this.correct(camera);
  }

  /** Roll the rendered image, for OBSERVE where the quaternion carries the
   *  roll. The reference re-adopts from the quaternion on the next frame. */
  rollQuaternion(camera: THREE.Camera, angle: number): void {
    this.viewForwardInto(this.forward, camera);
    this.rollQuat.setFromAxisAngle(this.forward, angle);
    camera.quaternion.premultiply(this.rollQuat).normalize();
    this.adoptFromCamera(camera);
  }
}
