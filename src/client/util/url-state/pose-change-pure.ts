// Whether a camera pose has moved enough to claim a URL write, and whether a
// pose vector diverges enough from its default to claim wire bytes. Both
// answer against the pose's own scale rather than an absolute distance.

export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * The smallest pose change that counts, as a ratio of the pose's own scale —
 * an angle in radians for a rotation and a fraction of the camera-to-target
 * distance for a translation, which are one number because `|Δcam| / r` is the
 * angle the move subtends at the orbit target.
 *
 * Any threshold carrying a length is wrong at all but one vantage, and the
 * camera reaches both lunar orbit and the Local Group in a session. Two bounds
 * fix this one: below ~1e-3 the round-trip error is sub-pixel on any display,
 * and it must stay well above the float32 wire's own 6e-8 resolution or a
 * settled camera would rewrite the URL forever.
 * See `README.md` § What counts as a camera move.
 */
export const POSE_CHANGE_EPS = 1e-4;

/** The pose's only intrinsic length: camera to orbit target. Every threshold
 *  here is a fraction of it. OBSERVE has no orbit pivot but still carries one
 *  — the serialised look pin a parsec down the forward axis
 *  (`../../camera/observe/README.md`) — so this is non-zero in both modes. */
export function orbitRadius(cam: Vec3Like, tgt: Vec3Like): number {
  return Math.hypot(cam.x - tgt.x, cam.y - tgt.y, cam.z - tgt.z);
}

/** Is `v` far enough from `def`, at a pose of this scale, to be worth
 *  encoding? The wire's own per-component strict equality still decides the
 *  bytes; this only answers whether a viewer could see the difference. */
export function divergesFromDefault(
  v: Vec3Like,
  def: readonly [number, number, number],
  scale: number,
): boolean {
  return Math.hypot(v.x - def[0], v.y - def[1], v.z - def[2])
    > POSE_CHANGE_EPS * scale;
}

/**
 * Has the pose moved since `prev` — a 9-slot cam / tgt / up snapshot — by
 * enough to rewrite the URL?
 *
 * Three terms cover every gesture: orbit and dolly land in `cam` against the
 * orbit radius, pan and OBSERVE's look-around land in `tgt` against the same,
 * and roll moves neither point, only `camera.up`, a unit axis whose delta is
 * the roll angle itself.
 *
 * Pass pose vectors measured from the anchor the receiver rebuilds, not raw
 * local ones — a translation of both is motion here, and under a focal ride
 * that is motion the viewer cannot see (`url-state.ts` anchoredPose).
 */
export function poseChanged(
  prev: Readonly<Float64Array>,
  cam: Vec3Like,
  tgt: Vec3Like,
  up: Vec3Like,
): boolean {
  const dUp = Math.hypot(up.x - prev[6], up.y - prev[7], up.z - prev[8]);
  const upLen = Math.hypot(up.x, up.y, up.z);
  if (upLen > 0 && dUp > POSE_CHANGE_EPS * upLen) return true;

  const dCam = Math.hypot(cam.x - prev[0], cam.y - prev[1], cam.z - prev[2]);
  const dTgt = Math.hypot(tgt.x - prev[3], tgt.y - prev[4], tgt.z - prev[5]);
  // A degenerate radius leaves the move as the only length in play: any motion
  // counts, stillness still reads as unchanged, and no floor comes back.
  const scale = Math.max(orbitRadius(cam, tgt), dCam, dTgt);
  if (scale === 0) return false;
  return dCam > POSE_CHANGE_EPS * scale || dTgt > POSE_CHANGE_EPS * scale;
}
