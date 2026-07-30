// Oblate-body geometry shared by the mesh scale, the ring shader and the
// atmosphere march, so the three cannot describe different spheroids.

import type { Planet } from '../planet-system';

/**
 * Polar radius in equatorial radii, `1 − f`, for bodies with and without a
 * published flattening.
 *
 * Every consumer of a body's polar radius must come through here. The mesh's
 * `scale.y / scale.x`, the ring shader's `uPolarRadiusPc` and the atmosphere
 * shaders' `uPolarRadiusR` have to be the same number: the shell tests
 * ray-strikes against the spheroid this ratio defines, and the mesh draws the
 * one its scale defines. Any disagreement is a band the shell suppresses and
 * the mesh never covers — a dark seam at the limb, widest at the poles.
 */
export function polarRadiusRatio(planet: Pick<Planet, 'flattening'>): number {
  return 1 - (planet.flattening ?? 0);
}
