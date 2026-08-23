// Decision logic for the on-demand render gate: pose snapshot compare +
// the render/skip decision. See README.md.

import { ADAPT_SLEW_SETTLE_MAG } from '../hdr/exposure/scene-adaptation-pure';

export const POSE_SLOTS = 14;

export const SETTLE_MS = 1500;

interface Vec3Like { readonly x: number; readonly y: number; readonly z: number }
interface QuatLike extends Vec3Like { readonly w: number }

export function writePose(
  out: Float64Array,
  position: Vec3Like,
  quaternion: QuatLike,
  fov: number,
  target: Vec3Like,
  worldOffset: Vec3Like,
): void {
  out[0] = position.x;
  out[1] = position.y;
  out[2] = position.z;
  out[3] = quaternion.x;
  out[4] = quaternion.y;
  out[5] = quaternion.z;
  out[6] = quaternion.w;
  out[7] = fov;
  out[8] = target.x;
  out[9] = target.y;
  out[10] = target.z;
  out[11] = worldOffset.x;
  out[12] = worldOffset.y;
  out[13] = worldOffset.z;
}

/** Shift a stored snapshot's position + target slots by a translation
 *  applied AFTER the tick that captured it. Orientation, fov and
 *  worldOffset are untouched: the only such writer is the focal ride,
 *  which translates camera and target together and rotates nothing. A
 *  NaN-seeded slot stays NaN, so a snapshot that has never rendered
 *  still differs from every real pose. */
export function rebasePoseTranslation(
  pose: Float64Array, dx: number, dy: number, dz: number,
): void {
  pose[0] += dx;
  pose[1] += dy;
  pose[2] += dz;
  pose[8] += dx;
  pose[9] += dy;
  pose[10] += dz;
}

/** Exact inequality per slot — a NaN-seeded snapshot differs from any
 *  real pose, which is what makes the first tick render. */
export function posesDiffer(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < POSE_SLOTS; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

/** Did the applied exposure cut move enough to be a different scene?
 *
 *  The cut is a continuous quantity read back off the GPU, so exact
 *  inequality is not a "changed" test the way it is for the pose: the
 *  measurement feeds the exposure it was rendered at, and fp16 rounding
 *  in the statistic attachment leaves that loop alternating between two
 *  values ~1e-4 mag apart indefinitely. `ADAPT_SLEW_SETTLE_MAG` is the
 *  exposure subsystem's OWN "this much dm is the same dm" — borrowed
 *  rather than re-picked so the two cannot disagree.
 *
 *  Compare against the cut at the last invalidate, never the last
 *  frame's, or sub-threshold steps in one direction accumulate into a
 *  visible drift the gate never wakes for. NaN-seeded: unseeded reads as
 *  moved. */
export function exposureCutMoved(dm: number, lastInvalidatedDm: number): boolean {
  return !(Math.abs(dm - lastInvalidatedDm) <= ADAPT_SLEW_SETTLE_MAG);
}

export interface GateDecision {
  readonly render: boolean;
  readonly lastActiveMs: number;
}

/** `cadenceDue` renders THIS tick without stamping activity: a clock-
 *  cadence frame is a scheduled single redraw, and stamping it would drag
 *  the whole SETTLE_MS tail behind every one — ~90 extra frames per
 *  cadence frame at 60 Hz, which is the idleness the cadence exists to
 *  buy (README.md § The clock cadence). */
export function decideRender(
  state: { holds: number; lastActiveMs: number },
  inputs: { continuous: boolean; poseChanged: boolean; cadenceDue: boolean; nowMs: number },
): GateDecision {
  const active = inputs.continuous || inputs.poseChanged;
  const lastActiveMs = active ? inputs.nowMs : state.lastActiveMs;
  return {
    render:
      state.holds > 0 || active || inputs.cadenceDue
      || inputs.nowMs - lastActiveMs < SETTLE_MS,
    lastActiveMs,
  };
}
