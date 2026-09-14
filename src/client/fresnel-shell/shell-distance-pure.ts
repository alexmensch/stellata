// The rim shells' camera-distance attenuation, in the one place every
// backend reads it from: a near-fade so a wall the camera is closing on
// ramps out, and a depth dimming on one shared absolute pc scale.

/** Near-fade reach as a fraction of a shell's own extent. One shared
 *  proportion rather than three authored distances, so consumers five
 *  orders of magnitude apart — heliopause ~200 AU, cloud rims 1–50 pc,
 *  Local Bubble 75–300 pc — fade over the same fraction of themselves. */
export const NEAR_FADE_EXTENT_FRAC = 0.6;

/** Full-brightness headroom past a shell's own surface (pc). The shared
 *  scale is this clearance rather than an absolute camera distance,
 *  because a fixed reference sits *inside* any shell bigger than itself:
 *  at 150 pc flat the Local Bubble (max wall radius ~300 pc) had no
 *  vantage at all where its whole wall was undimmed. */
export const DEPTH_DIM_CLEARANCE_PC = 150;

/** Falloff exponent past that clearance. Below 1 so the ~50–2500 pc cloud
 *  span compresses into a readable range: at 1.0 the farthest clouds land
 *  near the dither floor, and inverse-square would be a 1600× range that
 *  blacks out everything past the nearest handful. */
export const DEPTH_DIM_POWER = 0.6;

/** The two camera-distance reaches a rim consumer needs, both off the one
 *  extent it already knows. Returned together because they are the writable
 *  slots `RimParams` names, so a consumer states its size once and cannot
 *  set one reach and leave the other on a foreign scale. */
export interface RimDistances {
  nearFadePc: number;
  depthDimRefPc: number;
}

/** Both reaches from a shell's own representative radius. */
export function rimDistancesForExtent(extentPc: number): RimDistances {
  return {
    nearFadePc: extentPc * NEAR_FADE_EXTENT_FRAC,
    depthDimRefPc: extentPc + DEPTH_DIM_CLEARANCE_PC,
  };
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
