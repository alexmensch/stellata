// The emission half of the HDR unit: apparent magnitude → linear
// luminance, and the peak a point source's display kernel carries. CPU
// mirror of emission.glsl — see README.md § Unit.

import { ARCSEC_TO_RAD } from '../util/astronomy-constants';
import { type Rgb, relativeLuminance } from './tonemap-pure';

/** Every emission clamps here before the write. Extended Reinhard maps
 *  anything past ~10× the white point to indistinguishable white, so the
 *  clamp loses nothing visible and leaves 16× additive-accumulation
 *  headroom under the fp16 max. */
export const LUMA_CEIL = 4096;

/** Surface-brightness zero point of a raymarched emission column,
 *  mag/arcsec² — the constant of the unit system, shared by every
 *  volumetric emitter.
 *
 *  A column Σρ·ds is flux per steradian whenever `density0` was normalised
 *  against zero-point-free flux `F = 10^(−0.4·m_V)`, because
 *  Φ = ∫∫ρ/s² dV = ∫(∫ρ ds) dΩ. The only conversion left is then the solid
 *  angle of one arcsec², which is what this is. Nothing about it is
 *  tunable, and in particular it carries no dependence on dust: an emitter
 *  whose zero point moves with its own extinction has folded an
 *  attenuation error into its luminosity. */
export const SB_ZERO_POINT = -2.5 * Math.log10(ARCSEC_TO_RAD * ARCSEC_TO_RAD);

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

/** Inverse of `pixelSolidAngleArcsec2`. A layer that needs a plate scale
 *  recovers it from `uOmegaPxArcsec2` rather than taking a second
 *  uniform, so a resize cannot leave the two disagreeing about the
 *  viewport. Mirrors `stellataPxPerRadian`. */
export function pxPerRadianFromSolidAngle(omegaPxArcsec2: number): number {
  return 1 / (ARCSEC_TO_RAD * Math.sqrt(Math.max(omegaPxArcsec2, 1e-12)));
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

/**
 * A population tint divided by its own relative luminance, so it carries
 * hue only.
 *
 * `surfaceBrightnessLuminance` is a scalar gain applied per channel, while
 * the emissivity it multiplies was normalised against a total flux. An
 * un-normalised tint therefore scales its own emitter's flux by its
 * relative luminance — 0.42 mag for the Local Group disc lavender, 0.39 mag
 * of bulge-vs-disc split for the Milky Way band. Harmless while a global
 * gain absorbed it; a photometric error the moment the unit is physical.
 */
export function lumaNormalisedTint(rgb: Rgb): Rgb {
  const y = relativeLuminance(rgb);
  if (!(y > 0)) return [1, 1, 1];
  return [rgb[0] / y, rgb[1] / y, rgb[2] / y];
}
