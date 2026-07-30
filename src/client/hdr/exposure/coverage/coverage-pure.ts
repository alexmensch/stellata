// Occluder-coverage math shared by the GPU pass and its CPU mirror: the
// depth inverse, deterministic disc taps, ring slant transmission, and
// the single-bracket depth range. Contract in README.md.

import { FAR_MARGIN, NEAR_FRACTION, NEAR_MIN_PC, type MemberSphere }
  from '../../../local-depth/slice-pure';

/** Tap count per source. Equal-area stratified, so the sampling error on
 *  a fraction is ~1/(2√K) — 6% at 64, well under the circle
 *  approximation it replaces (10% on Saturn's flattening alone). */
export const COVERAGE_TAPS = 64;

/** Vogel's golden angle, π(3 − √5) — the spiral that makes the tap set
 *  equal-area at any K without a stored table or an RNG. */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Relative depth slack below a source before a surface counts as an
 *  occluder. A source drawn into the same scene stamps its own depth, so
 *  without this every source occludes itself; a real occluder sits orders
 *  of magnitude nearer (Saturn at 1e-3 AU against Sol at 1 AU). */
export const SELF_OCCLUSION_SLACK = 1e-3;

/** Depth at or above this means nothing was drawn on that tap. Checked
 *  BEFORE the distance compare: a cleared texel reads as the bracket's
 *  far plane, which is nearer than any source beyond the bracket and
 *  would otherwise read as a full occlusion. */
export const CLEAR_DEPTH_EPS = 1e-6;

/**
 * Tap `i` of `k` over the unit disc, as (x, y) offsets in [-1, 1].
 * Deterministic — the GPU mirror computes the same point from
 * `gl_FragCoord`-derived indices, and `Math.random` would make the
 * statistic depend on frame order.
 */
export function coverageTap(i: number, k: number, out: [number, number]): [number, number] {
  const r = Math.sqrt((i + 0.5) / k);
  const theta = i * GOLDEN_ANGLE;
  out[0] = r * Math.cos(theta);
  out[1] = r * Math.sin(theta);
  return out;
}

/**
 * View-space distance a depth-buffer value came from, for a standard
 * perspective projection over `[nearPc, farPc]`. `depth01` is the raw
 * texel in [0, 1]; the exact inverse of `z → (z_ndc + 1) / 2`, so
 * `viewDistanceFromDepth(depthFromViewDistance(z)) === z`.
 */
export function viewDistanceFromDepth(depth01: number, nearPc: number, farPc: number): number {
  const zNdc = 2 * depth01 - 1;
  return (2 * farPc * nearPc) / ((farPc + nearPc) - zNdc * (farPc - nearPc));
}

/** Forward direction of `viewDistanceFromDepth` — the pinning mirror,
 *  and what a test needs to build a synthetic depth texel. */
export function depthFromViewDistance(zPc: number, nearPc: number, farPc: number): number {
  const zNdc = ((farPc + nearPc) * zPc - 2 * farPc * nearPc) / ((farPc - nearPc) * zPc);
  return 0.5 * (zNdc + 1);
}

/**
 * Is a tap occluded for a source at `sourceDistPc`? `depth01` is the tap's
 * depth texel from a bracket of `[nearPc, farPc]`.
 *
 * Two guards, in this order: a cleared texel is never an occluder
 * (§ CLEAR_DEPTH_EPS), and a surface within `SELF_OCCLUSION_SLACK` of the
 * source is the source's own stamp.
 */
export function tapOccluded(
  depth01: number,
  sourceDistPc: number,
  nearPc: number,
  farPc: number,
): boolean {
  if (depth01 >= 1 - CLEAR_DEPTH_EPS) return false;
  const zPc = viewDistanceFromDepth(depth01, nearPc, farPc);
  return zPc < sourceDistPc * (1 - SELF_OCCLUSION_SLACK);
}

/**
 * Fraction of a ring's light path that gets through, from the strip's
 * authored alpha and the ring's opening angle to the line of sight.
 *
 * The strips carry `alpha = 1 − e^−τ` at each ring's **normal** optical
 * depth (`data/textures/README.md` § Ring strips), so `τ = −ln(1 − alpha)`
 * and a slant path of `1/|sin B|` normal depths gives
 *
 * ```
 * T = e^(−τ/|sin B|) = (1 − alpha)^(1/|sin B|)
 * ```
 *
 * which needs one `pow` and no logs. It is what makes the SAME ring
 * opaque edge-on and translucent face-on — the geometry dependence a
 * single opacity scalar cannot express.
 */
export function ringTransmission(stripAlpha: number, sinOpeningAngle: number): number {
  const a = Math.min(Math.max(stripAlpha, 0), 1);
  if (a <= 0) return 1;
  if (a >= 1) return 0;
  const sinB = Math.max(Math.abs(sinOpeningAngle), 1e-6);
  return (1 - a) ** (1 / sinB);
}

/**
 * The single [near, far] bracket the occluder-depth pass renders in.
 * Deliberately NOT the local pass's slice partition: that pass clears
 * depth between slices, so only one slice's depth ever survives, and each
 * slice carries its own projection. One bracket answers the only question
 * asked here — "is a surface nearer than this source?" — and leaves the
 * local pass's attachment, and therefore its precision bound, untouched.
 */
export function coverageBracket(
  spheres: readonly MemberSphere[],
): { nearPc: number; farPc: number } | null {
  if (spheres.length === 0) return null;
  let minSurface = Infinity;
  let maxExtent = 0;
  for (const s of spheres) {
    minSurface = Math.min(minSurface, s.distPc - s.radiusPc);
    maxExtent = Math.max(maxExtent, s.distPc + s.radiusPc);
  }
  const nearPc = Math.max(NEAR_MIN_PC, NEAR_FRACTION * minSurface);
  return { nearPc, farPc: Math.max(FAR_MARGIN * maxExtent, nearPc * 2) };
}

/**
 * A source's visible fraction from the two independent losses.
 *
 * **Multiplicative, where the circle-era formula subtracted.** Subtracting
 * was forced by not knowing where an occluder sat relative to the frame
 * edge; measuring transmission over the on-screen part of the footprint
 * makes the composition exact — `clipped` is what fraction of the
 * footprint is in frame, `transmission` the mean throughput over exactly
 * that part.
 */
export function visibleFraction(clipped: number, transmission: number): number {
  return Math.min(Math.max(clipped, 0), 1) * Math.min(Math.max(transmission, 0), 1);
}
