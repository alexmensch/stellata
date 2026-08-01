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
 * Luminance from an extended source of surface brightness
 * `magPerArcsec2`, spread over `omegaArcsec2`. The flux magnitude inside
 * that solid angle is `magPerArcsec2 − 2.5·log10(omegaArcsec2)`; feeding
 * that through `luminanceForMagnitude` collapses the log round-trip to
 * this product, which is why a layer can apply it as a single scalar gain
 * and keep its chromaticity.
 *
 * The pixel solid angle is the **physical** answer and is what the
 * adaptation statistic wants. A **display** path takes
 * `rodSummationSolidAngleArcsec2` instead, so that threshold for an
 * extended source lands where the eye's is.
 *
 * Unclamped — a layer scaling a per-channel column by this must clamp the
 * product against `LUMA_CEIL`, not the factor.
 */
export function surfaceBrightnessLuminance(
  exposure: number,
  magPerArcsec2: number,
  omegaArcsec2: number,
): number {
  return luminanceForMagnitude(exposure, magPerArcsec2) * omegaArcsec2;
}

/**
 * Solid angle the eye sums an extended source's flux over, in arcsec² —
 * the rod summation area implied by pairing an instrument's
 * extended-source threshold surface brightness with its point-source
 * limit.
 *
 * A source at `thresholdMagArcsec2` lands on `L_THRESH` when this stands
 * in for the pixel solid angle in `surfaceBrightnessLuminance`, exactly as
 * a point source at `limitMag` does. Fixed in **angle**, so an extended
 * source's display luminance does not move with FOV — the eye's summation
 * area is a property of the retina, not of the plate scale.
 * `docs/science-hdr-pipeline.md` § 1 carries the derivation.
 */
export function rodSummationSolidAngleArcsec2(
  thresholdMagArcsec2: number,
  limitMag: number,
): number {
  return 10 ** (0.4 * (thresholdMagArcsec2 - limitMag));
}

/** Inverse of `rodSummationSolidAngleArcsec2`. A consumer needing the
 *  threshold back in the magnitude domain — the chart isobar contours a
 *  surface brightness — recovers it from the same solid angle the gain
 *  runs on rather than taking a second uniform, so the contour and the
 *  emission cannot disagree about where threshold is. Mirrors
 *  `stellataExtendedThresholdSb`. */
export function extendedThresholdSbFromSolidAngle(
  omegaSummationArcsec2: number,
  limitMag: number,
): number {
  return limitMag + 2.5 * Math.log10(omegaSummationArcsec2);
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
