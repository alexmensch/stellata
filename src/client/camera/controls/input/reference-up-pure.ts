// Pure roll algebra for the reference up axis: the level-up projection, the
// pole-cone correction weight, and signed roll angles. Frame-agnostic — the
// pole is an argument. See README.md § Reference up axis.

import type * as THREE from 'three';

/** Half-width of the cone around the reference axis inside which the
 *  level-up projection is ill-conditioned. Orbiting through the reference
 *  pole flips the level up by 180° over an arbitrarily small travel, so
 *  full-strength correction there whips the image; inside the cone
 *  TrackballControls' parallel-transported up governs instead. */
export const POLE_CONE_DEG = 15;
const POLE_CONE_SIN = Math.sin((POLE_CONE_DEG * Math.PI) / 180);

/** Half-width of the alignment-guide band: a roll gesture sticks to the
 *  reference orientation while the roll it requests stays within this of it.
 *  The only definition of the band — every consumer and test reads it from
 *  here rather than restating a number. */
export const SNAP_TO_LEVEL_DEG = 2;
export const SNAP_TO_LEVEL_RAD = (SNAP_TO_LEVEL_DEG * Math.PI) / 180;

/** Correction strength as a smoothstep over `sin θ`, θ = angle between the
 *  view axis and the reference axis. 1 outside the pole cone (correct to
 *  exactly level in one frame), easing to 0 at the pole. A function of
 *  geometry alone — no time constant, so a given drag path produces the
 *  same roll at any frame rate outside the cone. */
export function poleConeWeight(sinTheta: number): number {
  const t = Math.min(1, Math.max(0, sinTheta / POLE_CONE_SIN));
  return t * t * (3 - 2 * t);
}

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

/** Write the screen-up a `lookAt` along `forward` resolves against
 *  `referenceUp` — the reference axis projected into the image plane —
 *  and return `sin θ`. A return of 0 means the view axis lies exactly on
 *  the reference axis, where no level up exists and `out` is unusable. */
export function levelUpInto(
  out: THREE.Vector3,
  referenceUp: THREE.Vector3,
  forward: THREE.Vector3,
): number {
  out.copy(referenceUp).addScaledVector(forward, -referenceUp.dot(forward));
  const sinTheta = out.length();
  if (sinTheta > 0) out.divideScalar(sinTheta);
  return sinTheta;
}

/** Roll error under which the correction declines to write `up` at all.
 *
 *  **Without a deadband this function does not converge — it 2-CYCLES.** At
 *  its own fixed point the project / normalise / measure / rotate /
 *  normalise chain measures a residual of order 1e-18 rad, applies it, and
 *  lands one representable step away; the next frame's projection brings it
 *  back, forever. Since it runs every frame and every navigate-mode
 *  orientation source is a `lookAt` reading `camera.up`, that alternation
 *  reaches `camera.quaternion` — so the render gate's exact-equality pose
 *  snapshot sees a slot move every tick and the view can never idle, at any
 *  vantage (`../../../render-gate/README.md`). Measured before this existed:
 *  `up` moved on 200 of 200 frames, `quat.y` flicking between two adjacent
 *  doubles 1 ULP apart.
 *
 *  Declining to write below a threshold is the same hysteresis `slewDm`
 *  applies to the exposure cut, for the same reason: a bit-identical input
 *  re-derives a bit-identical output, so the loop is broken at the source
 *  rather than filtered downstream.
 *
 *  1e-4 rad is 0.0057°. This is a ROLL about the view axis, so it displaces
 *  a feature by `radius · angle`: at a 1500 px screen radius — beyond the
 *  half-diagonal of a 2560x1440 window — that is 0.15 px, under the
 *  cadence's 0.25 device-px scheduling threshold. It is four decades above
 *  the float noise that causes the cycle and four below `SNAP_TO_LEVEL_DEG`,
 *  so it neither leaves visible roll nor perturbs the alignment guide. A
 *  residual under it still ACCUMULATES: the error is measured against the
 *  reference each frame rather than integrated, so holonomy drift crosses
 *  the band and gets corrected. */
export const UP_CORRECTION_DEADBAND_RAD = 1e-4;

/** Rotate `up` in place toward the level up for `forward`, by the
 *  pole-cone-weighted fraction of the roll error. Returns the correction
 *  applied, in radians. `levelScratch` is caller-owned working space.
 *
 *  Bit-stable once inside `UP_CORRECTION_DEADBAND_RAD` — it writes nothing
 *  there. That is what keeps a captured slerp endpoint built from
 *  `referenceUp` from popping when steady-state correction resumes on
 *  landing, and what lets the render gate idle at all. */
export function correctUpTowardReference(
  up: THREE.Vector3,
  forward: THREE.Vector3,
  referenceUp: THREE.Vector3,
  levelScratch: THREE.Vector3,
): number {
  const sinTheta = levelUpInto(levelScratch, referenceUp, forward);
  if (sinTheta === 0) return 0;
  const w = poleConeWeight(sinTheta);
  if (w === 0) return 0;

  // An `up` collapsed onto the view axis carries no roll to measure, so it
  // is repaired rather than measured — this arm must stay ahead of the
  // deadband, or a degenerate up would read as "nothing to do" and leave
  // every downstream lookAt with no basis.
  const along = up.dot(forward);
  if (up.lengthSq() - along * along <= 0) {
    up.copy(levelScratch);
    return 0;
  }

  // Measured against `up` directly, NOT its projection: `levelScratch` is
  // perpendicular to `forward` by construction, so up's forward-parallel
  // component cancels out of both the cross and the dot, leaving the angle
  // unchanged. Skipping the projection here is what keeps the measurement
  // free of the two rounding steps that drove the cycle.
  const err = signedAngleAbout(up, levelScratch, forward);
  const applied = w * err;
  // Below the band NOTHING is written — not even the re-projection, which is
  // itself a rounding step and would cycle on its own.
  if (Math.abs(applied) < UP_CORRECTION_DEADBAND_RAD) return 0;
  up.addScaledVector(forward, -along).normalize();
  up.applyAxisAngle(forward, applied).normalize();
  return applied;
}
