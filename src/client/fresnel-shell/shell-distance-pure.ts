// The rim shells' camera-distance attenuation, in the one place every
// backend reads it from: a near-fade so a wall the camera is closing on
// ramps out, and a depth dimming on one shared absolute pc scale.

/** Near-fade reach as a fraction of a shell's own extent. One shared
 *  proportion rather than three authored distances, so consumers five
 *  orders of magnitude apart — heliopause ~200 AU, cloud rims 1–50 pc,
 *  Local Bubble 75–300 pc — fade over the same fraction of themselves. */
export const NEAR_FADE_EXTENT_FRAC = 0.6;

/** Distance out to which the depth dimming stays at full brightness (pc);
 *  beyond it the rim dims. Absolute and deliberately **not** per-material:
 *  relative brightness only reads as relative distance if the Local Bubble
 *  wall and a cloud beyond it are measured on the same scale. */
export const DEPTH_DIM_REF_PC = 150;

/** Inverse-linear. Clouds span ~50–2000 pc, so the inverse-square exponent
 *  would be a 1600× brightness range and everything past the nearest
 *  handful would go black. */
export const DEPTH_DIM_POWER = 1.0;

/** A shell's near-fade distance, from its own representative radius. */
export function nearFadePcForExtent(extentPc: number): number {
  return extentPc * NEAR_FADE_EXTENT_FRAC;
}

/**
 * The factor the rim alpha is multiplied by for a fragment `dViewPc` from
 * the camera. CPU mirror of the `stellata_fresnel_rim` chunk's
 * `shellDistanceAttenuation` and of its TSL twin. The near plane keeps
 * `dViewPc` strictly positive in any real draw, so none of the three
 * guards the divide with an epsilon that all three would then have to pin.
 */
export function shellDistanceAttenuation(
  dViewPc: number,
  nearFadePc: number,
  depthDimRefPc: number,
  depthPower: number,
): number {
  const nearFade = clamp01(dViewPc / nearFadePc);
  const depthDim = Math.pow(clamp01(depthDimRefPc / dViewPc), depthPower);
  return nearFade * depthDim;
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1);
}
