// Interpolation, frame compatibility and the clock plan behind
// `debug.capture()`. See README.md.

import * as THREE from 'three';
import type { DecodedView, ViewPose } from '../../util/url-state';

export type EaseName = 'smooth' | 'linear';

/** Quintic smootherstep: zero velocity AND zero acceleration at both ends,
 *  the shape `../../camera/arrival/README.md` § Profile lands arrivals on. */
export function easeAt(name: EaseName, u: number): number {
  const t = Math.min(1, Math.max(0, u));
  if (name === 'linear') return t;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export interface CapturePose {
  cam: THREE.Vector3;
  tgt: THREE.Vector3;
  up: THREE.Vector3;
  fov: number;
}

export function capturePose(pose: ViewPose): CapturePose {
  return {
    cam: new THREE.Vector3(...pose.cam),
    tgt: new THREE.Vector3(...pose.tgt),
    up: new THREE.Vector3(...pose.up).normalize(),
    fov: pose.fov,
  };
}

const rotation = new THREE.Quaternion();
const partial = new THREE.Quaternion();
const dirA = new THREE.Vector3();
const dirB = new THREE.Vector3();

/** Rotate `a` toward `b` by fraction `s` along the great circle joining
 *  them. Both must be unit; antipodal inputs resolve through
 *  `setFromUnitVectors`'s own perpendicular-axis pick. */
export function slerpUnit(
  a: THREE.Vector3, b: THREE.Vector3, s: number, out: THREE.Vector3,
): THREE.Vector3 {
  rotation.setFromUnitVectors(a, b);
  partial.identity().slerp(rotation, s);
  return out.copy(a).applyQuaternion(partial).normalize();
}

/** Interpolate along an ARC at a GEOMETRIC radius, not along the chord.
 *  A take that closes from 30 pc to 0.9 pc covers 1.5 decades: linear
 *  distance spends the whole move in the far field and then slams, because
 *  angular size runs as 1/d (`../../camera/arrival/README.md`
 *  § The angular-arrival problem). Equal time per decade is equal time per
 *  octave of apparent size. FOV rides the same rule, being angular too.
 *
 *  A radius of zero has no direction to slerp — the OBSERVE pose, parked at
 *  the focal origin — so those fall back to a straight chord. */
export function lerpPose(
  a: CapturePose, b: CapturePose, s: number, out: CapturePose,
): CapturePose {
  out.tgt.lerpVectors(a.tgt, b.tgt, s);
  slerpUnit(a.up, b.up, s, out.up);
  out.fov = a.fov * (b.fov / a.fov) ** s;

  dirA.subVectors(a.cam, a.tgt);
  dirB.subVectors(b.cam, b.tgt);
  const rA = dirA.length();
  const rB = dirB.length();
  if (rA === 0 || rB === 0) {
    out.cam.lerpVectors(a.cam, b.cam, s);
    return out;
  }
  slerpUnit(dirA.divideScalar(rA), dirB.divideScalar(rB), s, out.cam);
  out.cam.multiplyScalar(rA * (rB / rA) ** s).add(out.tgt);
  return out;
}

function focusKey(view: DecodedView): string {
  const focus = view.focus;
  if (focus === undefined) return 'default';
  if (focus === 'cleared') return 'cleared';
  return `${focus.kind}:${focus.id}`;
}

function offsetKey(view: DecodedView): string {
  return view.worldOffset === undefined ? 'none' : view.worldOffset.join(',');
}

/** Why these two blobs cannot be interpolated, or null when they can.
 *
 *  `cam` and `tgt` are coordinates in the floating local frame, whose origin
 *  is the focused object (`../../frame/README.md`). Two blobs anchored on
 *  different objects therefore describe their poses in different frames and
 *  a component-wise blend between them means nothing — it is not a near-miss
 *  that reads as slightly wrong, it is a take pointing somewhere neither blob
 *  asked for. */
export function frameMismatch(start: DecodedView, end: DecodedView): string | null {
  if (start.mode === 'observe' || end.mode === 'observe') {
    return 'OBSERVE-mode blob: the pose there is an orientation, not a camera '
      + 'position and target, so there is nothing to interpolate';
  }
  if (focusKey(start) !== focusKey(end)) {
    return `focus differs (${focusKey(start)} → ${focusKey(end)}): the two poses `
      + 'are measured from different origins. Re-share the end view from the '
      + 'same focus';
  }
  if (offsetKey(start) !== offsetKey(end)) {
    return `worldOffset differs (${offsetKey(start)} → ${offsetKey(end)}): the `
      + 'two poses sit in different local frames';
  }
  return null;
}

/** `delay` holds the start view, `move` flies, `hold` holds the end view,
 *  `done` is the frame the take releases everything on. */
export type TakePhase = 'delay' | 'move' | 'hold' | 'done';

export interface TakeShape {
  delayMs: number;
  moveMs: number;
  holdMs: number;
}

export interface TakeFrame {
  phase: TakePhase;
  /** Eased progress along the move: 0 through the delay, 1 from the moment
   *  it lands, so the held frames write the end pose exactly. */
  s: number;
}

/** Where a take stands this frame, from wall-clock elapsed since it began.
 *  Deriving the phase from elapsed time rather than advancing a counter is
 *  what makes a dropped frame cost that frame alone: the next one reads the
 *  clock and lands where it should be, instead of running the whole take
 *  late by the stall. */
export function takeFrameAt(
  shape: TakeShape, elapsedMs: number, ease: EaseName,
): TakeFrame {
  if (elapsedMs < shape.delayMs) return { phase: 'delay', s: 0 };
  const moving = elapsedMs - shape.delayMs;
  if (moving < shape.moveMs) {
    return { phase: 'move', s: easeAt(ease, moving / shape.moveMs) };
  }
  return { phase: moving - shape.moveMs >= shape.holdMs ? 'done' : 'hold', s: 1 };
}

export interface ClockPlan {
  /** Absolute `t` to jump to before the take, or null to leave the clock. */
  startT: number | null;
  /** Clock rate for the length of the move. */
  moveRate: number;
  /** Clock rate before and after it — the delay and hold phases. */
  idleRate: number;
  /** Absolute `t` to land on when the move ends, or null. */
  endT: number | null;
}

export interface ClockRequest {
  startT: number | null;
  endT: number | null;
  rate: number;
  seconds: number;
  currentT: number;
}

/** An end time is a destination, so it SOLVES the rate: the clock runs at
 *  whatever multiple lands on it as the camera lands on the end pose, and is
 *  pinned there for the rest of the take. With no end time the requested
 *  rate runs throughout — 0 for a frozen sky. */
export function planClock(request: ClockRequest): ClockPlan {
  const { startT, endT, rate, seconds, currentT } = request;
  if (endT === null) return { startT, moveRate: rate, idleRate: rate, endT: null };
  const from = startT ?? currentT;
  return { startT, moveRate: (endT - from) / seconds, idleRate: 0, endT };
}
