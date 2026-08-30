// Roll operations on the camera's own up vector and quaternion — the two
// roll authorities, one per camera mode. See README.md § Roll authority.

import * as THREE from 'three';
import { cameraLocalUpInto, levelUpInto, signedAngleAbout } from './roll-pure';

export class RollController {
  // Per-call scratch — reused so a per-frame call never allocates.
  private readonly forward = new THREE.Vector3();
  private readonly level = new THREE.Vector3();
  private readonly currentUp = new THREE.Vector3();
  private readonly rollQuat = new THREE.Quaternion();

  /** The camera's view axis, straight off the quaternion — deliberately not
   *  `target − position`. The two agree in steady state, but every camera
   *  animation drives orientation independently of the orbit pivot (warp
   *  points `controls.target` at the destination from launch), and the axis
   *  the user perceives roll about is the one they're looking down. */
  private viewForwardInto(out: THREE.Vector3, camera: THREE.Camera): THREE.Vector3 {
    return out.set(0, 0, -1).applyQuaternion(camera.quaternion);
  }

  /** Re-derive `camera.up` from the quaternion, so a `lookAt` reproduces
   *  the orientation the quaternion already holds instead of rolling away
   *  from it.
   *
   *  Every frame in OBSERVE, where the quaternion is the authority; on every
   *  frame a navigate ANIMATION owns the camera, where nothing else
   *  transports `up` against a view axis that is moving (README.md § The
   *  perpendicular invariant); and at the landing of a captured-endpoint
   *  slerp. **Never on a steady-state navigate frame**: `up → lookAt →
   *  quaternion → up` is a rounding round-trip that 2-cycles, and the
   *  quaternion is in the render gate's exact-equality pose snapshot
   *  (`../../../render-gate/README.md`), so a still view could never idle. */
  adoptFromCamera(camera: THREE.Camera): void {
    cameraLocalUpInto(camera.up, camera).normalize();
  }

  /** Explicit roll in NAVIGATE: turn `camera.up` about the view axis. The
   *  image rolls by exactly `angle` — a `lookAt` renders up's component
   *  perpendicular to forward, and rotating about forward turns that
   *  component by the same angle. */
  roll(camera: THREE.Camera, angle: number): void {
    this.viewForwardInto(this.forward, camera);
    camera.up.applyAxisAngle(this.forward, angle).normalize();
  }

  /** Explicit roll in OBSERVE, where the quaternion carries the rendered
   *  roll. `camera.up` re-adopts from it on the next frame. */
  rollQuaternion(camera: THREE.Camera, angle: number): void {
    this.viewForwardInto(this.forward, camera);
    this.rollQuat.setFromAxisAngle(this.forward, angle);
    camera.quaternion.premultiply(this.rollQuat).normalize();
    this.adoptFromCamera(camera);
  }

  /** Signed roll from `camera.up` to level against `levelPole` — the
   *  NAVIGATE residual. Read off `up` rather than the rendered quaternion
   *  because there the quaternion trails it by a frame: `lookAt` hasn't
   *  consumed the newest roll yet. */
  upRollError(camera: THREE.Camera, levelPole: THREE.Vector3): number {
    this.viewForwardInto(this.forward, camera);
    if (levelUpInto(this.currentUp, camera.up, this.forward) === 0) return 0;
    return this.rollErrorToward(levelPole);
  }

  /** Signed roll from the rendered screen-up to level against `levelPole` —
   *  the OBSERVE residual, where the quaternion is what the user sees. */
  renderedRollError(camera: THREE.Camera, levelPole: THREE.Vector3): number {
    this.viewForwardInto(this.forward, camera);
    cameraLocalUpInto(this.currentUp, camera);
    // Projected in place: `levelUpInto` copies its axis first, so aliasing
    // the two is a self-copy and the scratch stays one vector.
    if (levelUpInto(this.currentUp, this.currentUp, this.forward) === 0) return 0;
    return this.rollErrorToward(levelPole);
  }

  /** Signed angle from `currentUp` (already unit and ⊥ `forward`) to the up
   *  that renders `levelPole` upright for `forward`. */
  private rollErrorToward(levelPole: THREE.Vector3): number {
    if (levelUpInto(this.level, levelPole, this.forward) === 0) return 0;
    return signedAngleAbout(this.currentUp, this.level, this.forward);
  }

  /** Put the view level against `levelPole`, once. `camera.up` takes the
   *  pole's own image-plane projection, so the result is exactly level and
   *  stays perpendicular to the view axis — the invariant that keeps the
   *  projection well-conditioned as the orbit carries it around.
   *
   *  Level is a one-shot state, not a maintained one: orbiting away from
   *  here rolls the view again, which is the whole point of retiring the
   *  per-frame correction. No-op looking straight down the pole, where no
   *  level up exists. */
  levelTo(camera: THREE.Camera, levelPole: THREE.Vector3): void {
    this.viewForwardInto(this.forward, camera);
    if (levelUpInto(this.level, levelPole, this.forward) === 0) return;
    camera.up.copy(this.level);
  }

  /** URL restore. The components land on `camera.up` as an up AXIS, NOT
   *  projected into the image plane: the restore runs before the camera
   *  position and target are applied, so the view axis it would project
   *  against is the wrong one. A `lookAt` projects it at update time and
   *  reproduces the roll the link was saved with — including a link
   *  written when the axis was persistent state in its own right.
   *
   *  The caller re-establishes the perpendicular invariant with
   *  `adoptFromCamera` once the final `controls.update()` has run. */
  restore(camera: THREE.Camera, x: number, y: number, z: number): void {
    if (x === 0 && y === 0 && z === 0) return;
    camera.up.set(x, y, z).normalize();
  }
}
