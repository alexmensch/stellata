// Scaling a vector's component along a body's pole — the map that carries
// an oblate spheroid onto a sphere, and back.

/**
 * Scale the component of `(vx, vy, vz)` along the unit axis `(px, py, pz)`
 * by `s`, leaving the equatorial part untouched, into `out`.
 *
 * `s = 1 / polarRatio` carries a spheroid of polar radius `polarRatio`
 * (equatorial radii) onto the sphere of its equatorial radius; `s =
 * polarRatio` is the inverse. The map is linear about the body centre, so
 * lines map to lines with their parameter unchanged — which is what makes a
 * sphere test EXACT for a spheroid once both endpoints go through it,
 * rather than a closer approximation. A surface normal scales by the
 * inverse instead.
 */
export function scalePolarInto(
  vx: number, vy: number, vz: number,
  px: number, py: number, pz: number,
  s: number,
  out: [number, number, number],
): void {
  const along = (vx * px + vy * py + vz * pz) * (s - 1);
  out[0] = vx + px * along;
  out[1] = vy + py * along;
  out[2] = vz + pz * along;
}
