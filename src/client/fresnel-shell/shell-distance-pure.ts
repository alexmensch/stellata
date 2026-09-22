// The rim shells' camera-distance attenuation, in the one place every
// consumer reads it from: a near-fade so a wall the camera is closing on
// ramps out, and a depth dimming on one shared absolute pc scale.

/** Near-fade reach as a fraction of a shell's own extent — one shared
 *  proportion, not three authored distances. See README.md
 *  § Camera-distance attenuation for all three. */
export const NEAR_FADE_EXTENT_FRAC = 0.6;

/** Full-brightness headroom past a shell's own surface (pc) — a clearance,
 *  not an absolute reference. Don't flatten it back to a bare distance;
 *  README.md § Camera-distance attenuation carries what that broke. */
export const DEPTH_DIM_CLEARANCE_PC = 150;

/** Falloff exponent past that clearance, below 1 to keep the cloud span
 *  readable. */
export const DEPTH_DIM_POWER = 0.6;

/** The two camera-distance reaches a rim consumer needs. Returned together,
 *  and keyed as `RimParams` names them, so the pair is writable as one
 *  record. */
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
 * the camera. CPU mirror of `fresnel-rim-tsl.ts`'s
 * `shellDistanceAttenuationTsl`. The near plane keeps `dViewPc` strictly
 * positive in any real draw, so neither guards the divide with an epsilon
 * both would then have to pin.
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
