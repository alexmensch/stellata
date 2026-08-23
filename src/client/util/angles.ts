// Signed angle wrapping, and the small-angle-safe angle between two
// vectors. See README.md.

/** Wrap to (-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  let r = a - Math.floor(a / twoPi) * twoPi;
  if (r > Math.PI) r -= twoPi;
  return r;
}

/** Wrap to (-180, 180]. Degree sibling of `wrapAngle` — the form a
 *  longitude or right-ascension residual against a catalogue is read in. */
export function wrapDegrees(d: number): number {
  let r = d - Math.floor(d / 360) * 360;
  if (r > 180) r -= 360;
  return r;
}

/** Unsigned angle between two vectors, radians, neither needing to be
 *  normalised. 0 when either is degenerate.
 *
 *  `atan2(|a x b|, a.b)` rather than `acos` of the normalised dot,
 *  because the cosine is flat near zero: at 1e-6 rad the dot rounds to
 *  1 in float64 and `acos` returns 0, losing the angle entirely. Callers
 *  measuring a body's on-screen displacement between two frames, or a
 *  moon's separation from the disc it hides behind, live exactly there.
 *  `phaseAngleFromLegs` is the acos form, kept because a phase angle is
 *  read in degrees across the whole half-turn. */
export function angleBetweenRad(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  const dot = ax * bx + ay * by + az * bz;
  if (dot === 0 && cx === 0 && cy === 0 && cz === 0) return 0;
  return Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), dot);
}
