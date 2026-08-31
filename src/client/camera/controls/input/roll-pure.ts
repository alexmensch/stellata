// Pure roll algebra: the level-up projection and signed roll angles.
// Frame-agnostic — the pole is an argument. See README.md § Roll authority.

import type * as THREE from 'three';

/** Half-width of the alignment-guide band: a roll gesture sticks to level
 *  while the roll it requests stays within this of it. The only definition
 *  of the band — every consumer and test reads it from here rather than
 *  restating a number. */
export const SNAP_TO_LEVEL_DEG = 2;
export const SNAP_TO_LEVEL_RAD = (SNAP_TO_LEVEL_DEG * Math.PI) / 180;

/** Signed angle that rotates `from` onto `to` about `axis`, right-hand
 *  rule. Allocation-free — the cross product is inlined against `axis`. */
export function signedAngleAbout(
  from: THREE.Vector3,
  to: THREE.Vector3,
  axis: THREE.Vector3,
): number {
  const cx = from.y * to.z - from.z * to.y;
  const cy = from.z * to.x - from.x * to.z;
  const cz = from.x * to.y - from.y * to.x;
  return Math.atan2(cx * axis.x + cy * axis.y + cz * axis.z, from.dot(to));
}

/** The camera's own local +Y in world space — the screen-up currently
 *  rendered, whatever `camera.up` happens to hold. This is the roll the
 *  OBSERVE quaternion carries, and what a `lookAt` re-engaging
 *  TrackballControls must resolve against: resolving against world (0,1,0)
 *  instead snaps any accumulated pitch back through the horizontal plane. */
export function cameraLocalUpInto(
  out: THREE.Vector3,
  camera: THREE.Camera,
): THREE.Vector3 {
  return out.set(0, 1, 0).applyQuaternion(camera.quaternion);
}

/** Write the screen-up a `lookAt` along `forward` resolves against `axis` —
 *  the axis projected into the image plane — and return `sin θ`. A return
 *  of 0 means the view axis lies exactly on `axis`, where no level up
 *  exists and `out` is unusable. */
export function levelUpInto(
  out: THREE.Vector3,
  axis: THREE.Vector3,
  forward: THREE.Vector3,
): number {
  out.copy(axis).addScaledVector(forward, -axis.dot(forward));
  const sinTheta = out.length();
  if (sinTheta > 0) out.divideScalar(sinTheta);
  return sinTheta;
}
