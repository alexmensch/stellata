// The physSize below which every consumer of it stops responding, and the
// tolerance the one graceful consumer is held to. README.md#eliding-the-physical-size-branch.

import { POINT_SOURCE_FLAT_PEAK_DIAMETER_PX } from '../../hdr/emission/emission-pure';
import { PHYS_RATIO_THRESHOLD } from '../local-pass/star-local-cluster-pure';

/** Relative movement allowed in the super-Gaussian exponent when `physSize`
 *  is elided. README.md#eliding-the-physical-size-branch. */
export const DISC_EXPONENT_TOLERANCE = 0.0025;

/** Largest `physSize` (CSS px, diameter) at which pinning it to zero is safe.
 *  README.md#eliding-the-physical-size-branch. */
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
  // Tiering needs no term of its own: t ≤ 1, so the exponent term never
  // exceeds sizeMinPx · PHYS_RATIO_THRESHOLD.
  return Math.min(
    POINT_SOURCE_FLAT_PEAK_DIAMETER_PX,
    sizeMinPx * PHYS_RATIO_THRESHOLD * t,
  );
}
