// Decision logic for the on-demand render gate: pose snapshot compare +
// the render/skip decision. See README.md.

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

/** Exact inequality per slot — a NaN-seeded snapshot differs from any
 *  real pose, which is what makes the first tick render. */
export function posesDiffer(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < POSE_SLOTS; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

export interface GateDecision {
  readonly render: boolean;
  readonly lastActiveMs: number;
}

export function decideRender(
  state: { holds: number; lastActiveMs: number },
  inputs: { continuous: boolean; poseChanged: boolean; nowMs: number },
): GateDecision {
  const active = inputs.continuous || inputs.poseChanged;
  const lastActiveMs = active ? inputs.nowMs : state.lastActiveMs;
  return {
    render:
      state.holds > 0 || active || inputs.nowMs - lastActiveMs < SETTLE_MS,
    lastActiveMs,
  };
}
