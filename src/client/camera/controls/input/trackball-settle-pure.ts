// On-screen motion of one frame's TrackballControls step, and the floor
// the damping tail is snapped off under. See README.md § Damping settle
// floor.

/** Per-frame on-screen motion under which the navigate-mode damping tail
 *  is stopped, in CSS pixels. A pixel is a pixel from any vantage at any
 *  epoch, which is what makes this threshold admissible where a
 *  world-space one would not be (CLAUDE.md § Camera-anywhere). */
export const TRACKBALL_SETTLE_PX = 0.1;

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
