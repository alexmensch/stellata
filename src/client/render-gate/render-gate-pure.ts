// Decision logic for the on-demand render gate: pose snapshot compare +
// the render/skip decision. See README.md.

import { CADENCE_JND_MAG } from './cadence/clock-cadence-pure';
import { ulpsBetween } from '../util/ulp';

export const POSE_SLOTS = 14;

/** Slot names in `writePose` order, so a readout can say WHICH part of the
 *  pose moved rather than only that something did. */
export const POSE_SLOT_NAMES = [
  'pos.x', 'pos.y', 'pos.z',
  'quat.x', 'quat.y', 'quat.z', 'quat.w',
  'fov',
  'target.x', 'target.y', 'target.z',
  'worldOffset.x', 'worldOffset.y', 'worldOffset.z',
] as const;

export interface PoseDrift {
  readonly slot: string;
  readonly delta: number;
  readonly ulps: number;
}

/** The first slot that differs, with how far it moved in both absolute and
 *  representable-step terms, or null when the poses match. Diagnosis only —
 *  `posesDiffer` stays the hot path. */
export function firstPoseDrift(
  a: ArrayLike<number>, b: ArrayLike<number>,
): PoseDrift | null {
  for (let i = 0; i < POSE_SLOTS; i++) {
    if (a[i] !== b[i]) {
      return { slot: POSE_SLOT_NAMES[i], delta: a[i] - b[i], ulps: ulpsBetween(a[i], b[i]) };
    }
  }
  return null;
}

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
 *  applied AFTER the tick that captured it — the focal ride, which
 *  translates camera and target together and rotates nothing. Orientation,
 *  fov and worldOffset are untouched, so a rotation applied below the gate
 *  is NOT absorbable here and must instead decline steps too small to see
 *  (`README.md` § The focal ride names the second such writer). A
 *  NaN-seeded slot stays NaN, so a snapshot that has never rendered still
 *  differs from every real pose. */
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

/** Did the applied exposure cut move enough to be worth a frame?
 *
 *  **The threshold is perceptual, and must not become the exposure
 *  subsystem's settle band.** `ADAPT_SLEW_SETTLE_MAG` answers a different
 *  question — "is this numerically the same cut" — and is sized against
 *  fp16 readback quantisation, an order of magnitude under anything a
 *  viewer resolves. Waking on it hands the gate a self-sustaining loop:
 *  each wake buys `SETTLE_MS` of frames, every one of those frames
 *  re-measures, and the measurement's own noise re-arms the tail before
 *  it can expire — the focal ride's shape by another route
 *  (README.md § The focal ride). `dm` is in magnitudes, so the threshold
 *  is `CADENCE_JND_MAG`: the same 1 % of flux every other brightness
 *  driver schedules against (`cadence/README.md` § The thresholds).
 *
 *  Not exact inequality either, for the reason the band exists: the cut
 *  is read back off the GPU and feeds the exposure it was measured at,
 *  so equality on a continuous quantity is not a "changed" test.
 *
 *  Compare against the cut at the last invalidate, never the last
 *  frame's, or sub-threshold steps in one direction accumulate into a
 *  visible drift the gate never wakes for. NaN-seeded: unseeded reads as
 *  moved. */
export function exposureCutMoved(dm: number, lastInvalidatedDm: number): boolean {
  return !(Math.abs(dm - lastInvalidatedDm) <= CADENCE_JND_MAG);
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
