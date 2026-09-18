// The physSize below which every consumer of it stops responding, and the
// tolerance the one graceful consumer is held to. README.md § Eliding the
// physical-size branch.

import { POINT_SOURCE_FLAT_PEAK_DIAMETER_PX } from '../../hdr/emission/emission-pure';
import { PHYS_RATIO_THRESHOLD } from '../local-pass/star-local-cluster-pure';

/**
 * Relative movement allowed in the super-Gaussian exponent when `physSize`
 * is elided. Evaluated against a star carrying the catalog's largest radius
 * at the `uSizeMin` floor — a pairing no real star reaches, since a disc
 * wide enough to subtend the bound is far too bright to sit at that floor,
 * so the guarantee runs about 25× tighter over the shipped catalog than the
 * number says.
 */
export const DISC_EXPONENT_TOLERANCE = 0.0025;

/**
 * Largest `physSize` (CSS px, diameter) at which pinning it to zero is safe.
 * Tiering and `pxSize` are exact below the bound and the peak is bit-exact;
 * only the exponent moves, by at most `tolerance`.
 *
 * Uniform-driven rather than constant: `sizeMinPx` tracks the plate scale
 * once the exaggeration K floors, and both `distN` endpoints are debug
 * sliders. A zero or inverted `distN` span yields a zero bound, which
 * disables the elision rather than widening it.
 */
export function physSizeElisionBoundPx(
  sizeMinPx: number,
  distNMin: number,
  distNMax: number,
  tolerance: number = DISC_EXPONENT_TOLERANCE,
): number {
  const span = distNMax - distNMin;
  const smoothstepMax = span > 0 ? (tolerance * distNMin) / span : Infinity;
  // smoothstep(0, T, x) = 3t² − 2t³ ≤ 3t², so t = √(s/3) is conservative.
  const t = Math.min(1, Math.sqrt(Math.max(smoothstepMax, 0) / 3));
  return Math.min(
    sizeMinPx * PHYS_RATIO_THRESHOLD,
    POINT_SOURCE_FLAT_PEAK_DIAMETER_PX,
    sizeMinPx * PHYS_RATIO_THRESHOLD * t,
  );
}
