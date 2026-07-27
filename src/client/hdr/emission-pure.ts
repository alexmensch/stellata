// The emission half of the HDR unit: apparent magnitude → linear
// luminance, and the peak a point source's display kernel carries. CPU
// mirror of emission.glsl — see README.md § Unit.

import { NAKED_EYE_LIMIT_MAG } from '../filters/filter-state';
import { L_THRESH } from './tonemap-pure';

/** Every emission clamps here before the write. Extended Reinhard maps
 *  anything past ~10× the white point to indistinguishable white, so the
 *  clamp loses nothing visible and leaves 16× additive-accumulation
 *  headroom under the fp16 max. */
export const LUMA_CEIL = 4096;

/** `uExposure` for a magnitude limit — the luminance a source at m = 0
 *  carries, fixed so a source at `magLimit` lands exactly on
 *  `L_THRESH`. */
export function exposureForMagLimit(magLimit: number, lThresh = L_THRESH): number {
  return lThresh * 10 ** (0.4 * magLimit);
}

/** The base exposure epoch: every light decision in the scene grounds on
 *  the naked-eye preset (docs/science-hdr-pipeline.md § 3). H6 routes the
 *  slider and the instrument multipliers through here; until then every
 *  emitter is pinned to this value. */
export const BASE_EPOCH_EXPOSURE = exposureForMagLimit(NAKED_EYE_LIMIT_MAG);

/** Linear luminance of a source at V-band apparent magnitude `m`.
 *  Unclamped — the ceiling belongs to whatever writes the fragment. */
export function luminanceForMagnitude(exposure: number, m: number): number {
  return exposure * 10 ** (-0.4 * m);
}

/**
 * Peak luminance of a point source's display kernel.
 *
 * `physRadiusPx` is the source's true angular radius in **CSS** pixels,
 * unclamped by any viewport-fraction cap. Below 1 px the source is
 * physically unresolved and its whole flux lands on the peak; above it
 * the emission becomes true surface brightness — flux spread over the
 * physical disc — so a star dims per-pixel as the camera closes in,
 * exactly as in nature.
 */
export function pointSourcePeakLuminance(
  exposure: number,
  m: number,
  physRadiusPx: number,
): number {
  const flux = luminanceForMagnitude(exposure, m);
  const spread = Math.max(1, Math.PI * physRadiusPx * physRadiusPx);
  return Math.min(flux / spread, LUMA_CEIL);
}
