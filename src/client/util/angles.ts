// Signed angle wrapping, radians and degrees. Both land on the
// half-open turn centred at zero, which is what comparing two angles for
// a difference needs.

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
