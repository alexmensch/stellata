// CPU mirror of perceptual-disc.glsl: the dM soft knee, the √Δm size
// curve, the super-Gaussian exponent and its profile. The chunk's header
// carries the math; every other mirror composes over this module.

import { PHYS_RATIO_THRESHOLD } from './local-pass/star-local-cluster-pure';

/** Michaelis-Menten denominator floor — keeps the knee finite at
 *  `sizeKnee = 0`, which is the hard-clamp the knee replaced. */
export const DM_KNEE_FLOOR = 1e-6;

/** `sizeSpan` divisor floor for the √Δm curve. */
export const SIZE_SPAN_FLOOR = 0.001;

export function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * Soft-knee `dM_eff` curve. `dM = limitMag − appMag` is "magnitudes
 * brighter than the instrument's limit."
 *
 * - For `dM ≤ sizeSpan`, returns `max(dM, 0)` — the linear region.
 * - For `dM > sizeSpan`, bends through a Michaelis-Menten asymptote
 *   that approaches `sizeSpan + sizeKnee` as `dM → ∞`. Lets very
 *   bright sources keep growing past the linear ceiling instead of
 *   hard-clamping there.
 */
export function perceptualDmEff(
  appMag: number,
  limitMag: number,
  sizeSpan: number,
  sizeKnee: number,
): number {
  const dM = limitMag - appMag;
  if (dM <= sizeSpan) return Math.max(dM, 0);
  const over = dM - sizeSpan;
  return sizeSpan + (sizeKnee * over) / Math.max(sizeKnee + over, DM_KNEE_FLOOR);
}

/** Apparent-magnitude → disc pixel diameter: `√(dMEff / sizeSpan)`
 *  blended through `[sizeMin, sizeMax]`. */
export function perceptualAppSizePx(
  dMEff: number,
  sizeMin: number,
  sizeMax: number,
  sizeSpan: number,
): number {
  const t = Math.sqrt(dMEff / Math.max(sizeSpan, SIZE_SPAN_FLOOR));
  return sizeMin + t * (sizeMax - sizeMin);
}

/** Super-Gaussian exponent the profile runs at. Extracted so a caller that
 *  needs the kernel's area integral gets the same `n` the profile shaped
 *  itself with, rather than re-deriving the morph. */
export function perceptualDiscExponent(
  softness: number,
  physRatio: number,
  distNMin: number,
  distNMax: number,
  lumBiasMin: number,
  lumBiasMax: number,
): number {
  const t = smoothstep01(physRatio / PHYS_RATIO_THRESHOLD);
  const distN = distNMin + (distNMax - distNMin) * t;
  const lumBias = lumBiasMin + (lumBiasMax - lumBiasMin) * softness;
  return distN * lumBias;
}

/** Radial intensity `I(r)` of the unit-peak kernel, renormalised so
 *  `I(0.5) = 0` exactly. `visibleK` is `-log(visibleThreshold)`, passed in
 *  because the shaders take it as a uniform rather than recomputing a log
 *  per fragment. */
export function perceptualDiscProfile(
  r: number,
  n: number,
  visibleThreshold: number,
  visibleK: number,
): number {
  const raw = Math.exp(-visibleK * Math.pow(2 * r, n));
  return Math.max(0, (raw - visibleThreshold) / (1 - visibleThreshold));
}
