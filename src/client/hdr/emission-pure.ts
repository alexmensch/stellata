// The emission half of the HDR unit: apparent magnitude → linear
// luminance, and the peak a point source's display kernel carries. CPU
// mirror of emission.glsl — see README.md § Unit.

import { ARCSEC_TO_RAD } from '../util/astronomy-constants';

/** Every emission clamps here before the write. Extended Reinhard maps
 *  anything past ~10× the white point to indistinguishable white, so the
 *  clamp loses nothing visible and leaves 16× additive-accumulation
 *  headroom under the fp16 max. */
export const LUMA_CEIL = 4096;

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

/**
 * Peak of the same kernel renormalised to carry the source's true **flux**
 * rather than its true peak — what the adaptation statistic's flux channel
 * needs (`exposure/README.md` § What the statistic measures).
 *
 * `pointSourcePeakLuminance` spreads flux over `max(1, π·r_phys²)` while the
 * quad drawn is `quadDiameterPx` across, so the kernel preserves peak and
 * inflates energy — up to 29× for a knee-saturated source. Dividing by the
 * kernel's own area integral `Φ(n)·D²` makes the integral come back to
 * `L(m)` instead.
 *
 * Clamped at `LUMA_CEIL` for the same reason the display peak is: the
 * measurement is rendered at the live exposure, so a clamped read is a lower
 * bound that the adaptation loop closes from above.
 */
export function kernelFluxPeakLuminance(
  exposure: number,
  m: number,
  quadDiameterPx: number,
  fluxIntegral: number,
): number {
  const area = fluxIntegral * quadDiameterPx * quadDiameterPx;
  const flux = luminanceForMagnitude(exposure, m);
  return Math.min(flux / Math.max(area, 1e-9), LUMA_CEIL);
}

/**
 * Solid angle one **CSS** pixel subtends, in arcsec² — what converts a
 * surface brightness (mag/arcsec²) into the flux inside one pixel.
 *
 * `pxPerRadian` is `angularToPx(viewportHeightCssPx, fovYRad)`. CSS rather
 * than device pixels for the reason `pointSourcePeakLuminance` uses them:
 * the scene must not change brightness with `devicePixelRatio`. Zooming in
 * shrinks it quadratically, so an extended source dims per-pixel exactly
 * as a resolved disc does under the point-source rule — the physical
 * magnification loss an aperture gain has to pay for.
 */
export function pixelSolidAngleArcsec2(pxPerRadian: number): number {
  const arcsecPerPx = 1 / (ARCSEC_TO_RAD * Math.max(pxPerRadian, 1e-9));
  return arcsecPerPx * arcsecPerPx;
}

/**
 * Luminance one pixel receives from an extended source of surface
 * brightness `magPerArcsec2`. The pixel's flux magnitude is
 * `magPerArcsec2 − 2.5·log10(omegaPxArcsec2)`; feeding that through
 * `luminanceForMagnitude` collapses the log round-trip to this product,
 * which is why a layer can apply it as a single scalar gain and keep its
 * chromaticity.
 *
 * Unclamped — a layer scaling a per-channel column by this must clamp the
 * product against `LUMA_CEIL`, not the factor.
 */
export function surfaceBrightnessLuminance(
  exposure: number,
  magPerArcsec2: number,
  omegaPxArcsec2: number,
): number {
  return luminanceForMagnitude(exposure, magPerArcsec2) * omegaPxArcsec2;
}
