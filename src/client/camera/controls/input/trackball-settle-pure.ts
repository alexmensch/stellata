// On-screen motion of one frame's TrackballControls step, and the floors
// its damping tail and its re-derived pose are snapped still under. See
// README.md § Damping settle floor and § Derived-pose settle floor.

import { ulpsBetween } from '../../../util/ulp';

/** Per-frame on-screen motion under which the navigate-mode damping tail
 *  is stopped, in CSS pixels. A pixel is a pixel from any vantage at any
 *  epoch, which is what makes this threshold admissible where a
 *  world-space one would not be (CLAUDE.md § Camera-anywhere). */
export const TRACKBALL_SETTLE_PX = 0.1;

/** Per-frame quaternion drift under which the orientation `lookAt`
 *  re-derived is held at its previous bits, in float64 ULP.
 *
 *  Sized off a measured sweep, not picked: a pure focal ride — camera and
 *  target stepped by the same delta, so no rotation happens at all — moves
 *  the derived quaternion by at most 219 ULP across 8 vantages (1e-6 pc to
 *  1e4 pc) x 5 body-step sizes x 3 fovs. The smallest rotation a viewer can
 *  ask for, one hundredth of a pixel, is 4.6e18 ULP. This sits ~19x above
 *  the measured noise and ~15 orders below the smallest real move, so no
 *  input can fall inside it. § Orientation settle floor owns the argument. */
export const ORIENTATION_SETTLE_ULP = 4096;

/** Per-frame position drift under which the position `TrackballControls`
 *  round-trips through its eye vector (`eye = position - target`, then
 *  `position = target + eye`) is held at its previous bits, in float64 ULP.
 *
 *  Far tighter than the orientation floor because a position ULP has no
 *  fixed angular meaning: at a vantage far from the local origin but close
 *  to the target, a wide floor would be a visible fraction of the eye
 *  vector. The measured round-trip drift is 0-1 ULP at every vantage from
 *  1e-6 pc to 1e4 pc, so 16 leaves ample headroom while staying under
 *  0.01 px of swing even in that worst-case geometry. */
export const POSITION_SETTLE_ULP = 16;

interface Vec3Like { readonly x: number; readonly y: number; readonly z: number }

const lengthOf = (v: Vec3Like): number => Math.hypot(v.x, v.y, v.z);

/** Angle between two vectors, through the chord of the normalised pair.
 *  `acos` of a dot product cancels away its significant digits at
 *  exactly the sub-milliradian angles this floor has to resolve. */
export function eyeSwingRad(prev: Vec3Like, now: Vec3Like): number {
  const lp = lengthOf(prev);
  const ln = lengthOf(now);
  if (lp === 0 || ln === 0) return 0;
  const chord = Math.hypot(
    now.x / ln - prev.x / lp,
    now.y / ln - prev.y / lp,
    now.z / ln - prev.z / lp,
  );
  return 2 * Math.asin(Math.min(1, chord / 2));
}

/** What this frame's camera step moved on screen, in CSS px: the eye's
 *  angular swing, plus what the dolly did to a feature at the frame
 *  edge. Those are the only two residuals the damping can produce — pan
 *  is off permanently (README.md § TrackballControls tuning) — so the
 *  target's own motion (a focal ride, a recentre) is deliberately not a
 *  term: it carries camera and target together and owes no tail. */
export function trackballMotionPx(
  prevEye: Vec3Like,
  eye: Vec3Like,
  pxPerRad: number,
  fovYRad: number,
): number {
  const lp = lengthOf(prevEye);
  const ln = lengthOf(eye);
  const longer = Math.max(lp, ln);
  const dollyRad = longer === 0 ? 0 : (Math.abs(ln - lp) / longer) * (fovYRad / 2);
  return (eyeSwingRad(prevEye, eye) + dollyRad) * pxPerRad;
}

interface QuatLike extends Vec3Like { readonly w: number }

/** The widest per-component move between two orientations, in ULP. Widest
 *  rather than summed so one component drifting cannot be averaged away by
 *  three that held. NaN in any component reads as a real move, since a
 *  seeded-but-not-yet-valid orientation must not be held. */
export function quatDriftUlps(a: QuatLike, b: QuatLike): number {
  const parts = [
    ulpsBetween(a.x, b.x), ulpsBetween(a.y, b.y),
    ulpsBetween(a.z, b.z), ulpsBetween(a.w, b.w),
  ];
  let worst = 0;
  for (const p of parts) {
    if (Number.isNaN(p)) return Number.POSITIVE_INFINITY;
    if (p > worst) worst = p;
  }
  return worst;
}

/** Is this orientation the previous one plus float noise, rather than a
 *  move? True means the caller should restore the previous bits. */
export function orientationHeldStill(prev: QuatLike, now: QuatLike): boolean {
  return quatDriftUlps(prev, now) <= ORIENTATION_SETTLE_ULP;
}

/** The widest per-axis move between two positions, in ULP. */
export function vec3DriftUlps(a: Vec3Like, b: Vec3Like): number {
  const parts = [ulpsBetween(a.x, b.x), ulpsBetween(a.y, b.y), ulpsBetween(a.z, b.z)];
  let worst = 0;
  for (const p of parts) {
    if (Number.isNaN(p)) return Number.POSITIVE_INFINITY;
    if (p > worst) worst = p;
  }
  return worst;
}

/** Is this position the previous one plus float noise, rather than a move? */
export function positionHeldStill(prev: Vec3Like, now: Vec3Like): boolean {
  return vec3DriftUlps(prev, now) <= POSITION_SETTLE_ULP;
}
