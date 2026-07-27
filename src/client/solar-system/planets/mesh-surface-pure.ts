// Planet mesh + ring + airlight emission into the scene-wide HDR unit:
// the disc-mean normalisers that make the shaded disc integrate to the
// body's true flux. See README.md § Physical-luminance emission.

import { ARCSEC_TO_RAD } from '../../util/astronomy-constants';
import { luminanceForMagnitude, surfaceBrightnessLuminance } from '../../hdr/emission-pure';
import { bodySurfaceBrightnessMagArcsec2, hostIrradianceMagnitude } from '../perceptual-magnitude';

/** Limb-darkening floor and exponent — `mix(LIMB_FLOOR, 1, μ^LIMB_EXP)`.
 *  Mirrored as literals in `planet-mesh.frag.glsl`; the drift test pins
 *  them. Atmospheric bodies substitute a floor of 1 (no limb term: the
 *  scattering governs their limb). */
export const LIMB_FLOOR = 0.45;
export const LIMB_EXP = 0.5;

/**
 * Disc-average of `μ · mix(limbFloor, 1, μ^limbExp)` at full phase, where
 * `μ = cos` of both the incidence and emission angle and the average is
 * area-weighted over the projected disc.
 *
 * ```
 * mean = 2·( F/3 + (1−F)/(3+E) )
 * ```
 *
 * Dividing the shading by this is what makes the mesh's disc integral
 * equal the body's true flux: the Lambert `μ` term contributes 2/3 (the
 * factor that turns mean radiance into the geometric-albedo convention
 * `planetApparentMagnitude` uses), and limb darkening redistributes at
 * unit mean rather than dimming the body.
 *
 * A floor of 1 recovers the pure Lambert 2/3.
 */
export function lambertLimbDiscMean(limbFloor: number, limbExp: number): number {
  return 2 * (limbFloor / 3 + (1 - limbFloor) / (3 + limbExp));
}

/** Per-pixel HDR luminance of a surface that reflected the host's light
 *  perfectly diffusely at unit albedo — the common scale the airlight,
 *  the ring strip, and the body surface all ride, so their relative
 *  brightness is fixed by physics rather than matched by hand.
 *
 *  `E · Ω_px`: the host's irradiance at the body on the luminance scale,
 *  times the solid angle one pixel subtends. Ω_px is why zooming dims an
 *  extended source (`../../hdr/README.md` § Unit) — the same factor that
 *  dims a resolved disc's peak under the point-source rule, which is what
 *  keeps mesh and glare continuous at any FOV. */
export function hostIrradianceLuminance(
  exposure: number,
  omegaPxArcsec2: number,
  hostAbsmag: number,
  dHpPc: number,
): number {
  const irradiance = luminanceForMagnitude(
    exposure,
    hostIrradianceMagnitude(hostAbsmag, dHpPc),
  );
  return irradiance * omegaPxArcsec2 * ARCSEC_TO_RAD * ARCSEC_TO_RAD;
}

/**
 * The scalar the mesh fragment shader multiplies its shaded, textured
 * surface by, so that the disc integral equals the body's true flux.
 *
 * `S₀` (`bodySurfaceBrightnessMagArcsec2`) gives the disc's mean surface
 * brightness; dividing by the two disc means turns everything the shader
 * multiplies on top into a pure redistribution:
 *
 * - `shadingDiscMean` — Lambert × limb darkening (above).
 * - `baseMeanLuminance` — the day map's own mean linear luminance, or the
 *   representative colour's luminance when the body has no map. The maps
 *   are brightness-stretched mosaics whose absolute level is not
 *   radiometric, so the level has to come from the geometric albedo in
 *   `S₀` and the map may only supply the pattern. Normalising here is also
 *   what makes the texture arriving mid-approach flux-neutral: the
 *   flat-colour and textured paths target the same disc integral.
 *
 * Phase is deliberately absent — the shader's own terminator integrates
 * to φ(α), and `uPhaseScale` corrects that to the body's measured curve.
 */
export function meshSurfaceLuminance(
  exposure: number,
  omegaPxArcsec2: number,
  hostAbsmag: number,
  dHpPc: number,
  albedo: number,
  baseMeanLuminance: number,
  hasAtmosphere: boolean,
): number {
  const meanL = surfaceBrightnessLuminance(
    exposure,
    bodySurfaceBrightnessMagArcsec2(hostAbsmag, dHpPc, albedo),
    omegaPxArcsec2,
  );
  const shadingDiscMean = lambertLimbDiscMean(hasAtmosphere ? 1 : LIMB_FLOOR, LIMB_EXP);
  return meanL / (shadingDiscMean * Math.max(baseMeanLuminance, 1e-6));
}
