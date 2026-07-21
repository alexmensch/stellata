// CPU-side mirror of shaders/perceptual-disc.glsl — apparent-magnitude
// math and brightness → disc-radius mapping the star and planet vertex
// shaders use. Shader is the source of truth; this mirror is test-pinned.

import { AU_PC, SUN_ABSMAG_V } from '../util/astronomy-constants';
import { NAKED_EYE_LIMIT_MAG } from '../filters/filter-state';

// Magnitudes below the slider cutoff a body still renders: the vertex
// shaders fade the disc out over this soft taper rather than hard-cutting
// at `uMaxAppMag`, so a body is drawn (and therefore pickable) while
// `appMag <= uMaxAppMag + SOFT_TAPER_MARGIN_MAG`. Every CPU mirror that
// gates on "is this drawn?" — pick paths, orbit-walk LOD, eclipse LOD —
// reads this so the CPU cutoff can't drift from the shader's. Chart mode
// hard-clips at `uMaxAppMag` instead (no taper); callers add the margin
// only in the non-chart path.
export const SOFT_TAPER_MARGIN_MAG = 0.5;

/**
 * Standard apparent-magnitude formula for an unobscured emitter.
 *
 * `M + 5·(log10(d/pc) − 1) = M + 5·log10(d / 10pc)`.
 *
 * Floors `dPc` at 1e-30 so callers don't need to guard against zero
 * distances at the singular focal-star point — matches the GLSL
 * shader's behaviour exactly.
 */
export function apparentMagnitude(absmag: number, dPc: number): number {
  const d = Math.max(dPc, 1e-30);
  return absmag + 5 * (Math.log10(d) - 1);
}

/**
 * Soft-knee `dM_eff` curve. `dM = maxAppMag − appMag` is "magnitudes
 * brighter than the visibility cutoff."
 *
 * - For `dM ≤ sizeSpan`, returns `max(dM, 0)` — the linear region.
 * - For `dM > sizeSpan`, bends through a Michaelis-Menten asymptote
 *   that approaches `sizeSpan + sizeKnee` as `dM → ∞`. Lets very
 *   bright sources keep growing past the linear ceiling instead of
 *   hard-clamping there.
 *
 * Identical arithmetic to `perceptualDmEff` in
 * shaders/perceptual-disc.glsl.
 */
export function perceptualDmEff(
  appMag: number,
  maxAppMag: number,
  sizeSpan: number,
  sizeKnee: number,
): number {
  const dM = maxAppMag - appMag;
  if (dM <= sizeSpan) return Math.max(dM, 0);
  const over = dM - sizeSpan;
  return sizeSpan + (sizeKnee * over) / Math.max(sizeKnee + over, 1e-6);
}

/**
 * Apparent-magnitude → disc pixel diameter. `√(dMEff / sizeSpan)`
 * blended through `[sizeMin, sizeMax]`. Identical arithmetic to
 * `perceptualAppSizePx` in shaders/perceptual-disc.glsl.
 */
export function perceptualAppSizePx(
  dMEff: number,
  sizeMin: number,
  sizeMax: number,
  sizeSpan: number,
): number {
  const t = Math.sqrt(dMEff / Math.max(sizeSpan, 0.001));
  return sizeMin + t * (sizeMax - sizeMin);
}

/**
 * Reflected-light apparent magnitude of a planet seen by a viewer. CPU
 * mirror of the integrated formula in shaders/planet.vert.glsl.
 *
 *   m_host_at_planet = M_host + 5·log10(d_hp / 10pc)
 *   m_planet         = m_host_at_planet
 *                    − 2.5·log10( p · (R/d_vp)² · φ(α) )
 *
 * The viewer→host distance d_vh cancels out of the physical formula
 * (host flux at the viewer × d_vh² round-trip) and MUST NOT appear:
 * observe mode parks the camera exactly at the host, so any d_vh term
 * evaluates log10(0) there and kills every planet of the focused host.
 *
 * - `hostAbsmag` is the host star's absolute V-band magnitude.
 * - `dVpPc` is viewer→planet distance in parsecs.
 * - `dHpPc` is host→planet distance in parsecs.
 * - `albedo` is the planet's geometric albedo p (dimensionless).
 * - `radiusPc` is the planet's physical radius in parsecs.
 * - `phaseFactor` is φ(α) — pass 1 for full-phase, or use
 *   `lambertianPhaseFactor` / `mallamaPhaseFactor` from `phase-function.ts`.
 *
 * Distances and the reflectance product floor at 1e-30 to match the
 * shader's defensive clamps at the singular zero-distance point.
 */
/** Display-compression exponent on the host-irradiance ratio: raw
 *  1/d² spans ~4 decades Mercury→Pluto, unrenderable in LDR; the
 *  quarter power maps it to ~[0.16, 1.6]. */
export const HOST_IRRADIANCE_DISPLAY_EXPONENT = 0.25;
export const HOST_INTENSITY_MIN = 0.12;
export const HOST_INTENSITY_MAX = 1.6;

/** Apparent magnitude of the reference source (a solar-luminosity host)
 *  at the reference distance (1 AU) — the irradiance anchor for
 *  `hostIntensityScale`. `E_body / E_ref = 10^(0.4·(this − m_host@body))`
 *  so a body 1 AU from Sol reads a ratio of exactly 1. */
export const HOST_IRRADIANCE_REF_MAG = SUN_ABSMAG_V + 5 * (Math.log10(AU_PC) - 1);

/**
 * Mesh-regime lighting intensity from the host's irradiance at the body:
 * `(E_body / E_ref)^HOST_IRRADIANCE_DISPLAY_EXPONENT`, clamped to
 * [HOST_INTENSITY_MIN, HOST_INTENSITY_MAX]. `E_body` is the host flux at
 * the body, folding the host's absolute magnitude — so an O-class host
 * lights its bodies far brighter than Sol does at the same distance. The
 * ratio is `10^(0.4·(HOST_IRRADIANCE_REF_MAG − m_host@body))` with
 * `m_host@body = M_host + 5·(log10(d_hp) − 1)`; for Sol it reduces exactly
 * to the old `(d_AU)^(−0.5)` law. Deliberately independent of viewer
 * distance: fixed for a given orbital position, so it cannot blow out as
 * the camera approaches — the failure mode that rules out any
 * viewer-distance term in mesh brightness.
 */
export function hostIntensityScale(hostAbsmag: number, dHpPc: number): number {
  const dPc = Math.max(dHpPc, 1e-30);
  const mHostAtBody = hostAbsmag + 5 * (Math.log10(dPc) - 1);
  const irradianceRatio = 10 ** (0.4 * (HOST_IRRADIANCE_REF_MAG - mHostAtBody));
  const scale = irradianceRatio ** HOST_IRRADIANCE_DISPLAY_EXPONENT;
  return Math.min(HOST_INTENSITY_MAX, Math.max(HOST_INTENSITY_MIN, scale));
}

/** Sensitivity reference: lit-surface exposure is exactly 1 at the
 *  naked-eye preset, so the default framing is untouched by the
 *  slider coupling. */
export const LIT_EXPOSURE_REF_MAG = NAKED_EYE_LIMIT_MAG;

/**
 * Mesh-regime lighting intensity: `hostIntensityScale` composed with
 * the magnitude slider as a camera-sensitivity exposure. The slider is
 * the camera's flux threshold, so the exposure is the threshold flux
 * ratio `10^((maxAppMag − ref)/2.5)` under the same
 * HOST_IRRADIANCE_DISPLAY_EXPONENT compression the irradiance term
 * uses — one display law for both inputs. The product keeps the
 * HOST_INTENSITY_MAX ceiling (LDR: values past it only clip textures)
 * but not the floor: at low sensitivity a dim surface fades toward
 * black exactly like the star field does. Still no viewer-distance
 * term — approach cannot blow it out.
 */
export function litIntensity(
  hostAbsmag: number,
  dHpPc: number,
  maxAppMag: number,
): number {
  const thresholdFluxRatio = 10 ** ((maxAppMag - LIT_EXPOSURE_REF_MAG) / 2.5);
  const exposure = thresholdFluxRatio ** HOST_IRRADIANCE_DISPLAY_EXPONENT;
  return Math.min(HOST_INTENSITY_MAX, hostIntensityScale(hostAbsmag, dHpPc) * exposure);
}

export function planetApparentMagnitude(
  hostAbsmag: number,
  dVpPc: number,
  dHpPc: number,
  albedo: number,
  radiusPc: number,
  phaseFactor: number,
): number {
  const dVp = Math.max(dVpPc, 1e-30);
  const dHp = Math.max(dHpPc, 1e-30);
  const mHostAtPlanet = hostAbsmag + 5 * (Math.log10(dHp) - 1);
  const radRatio = radiusPc / dVp;
  const reflFactor = albedo * radRatio * radRatio * Math.max(phaseFactor, 0);
  return mHostAtPlanet - 2.5 * Math.log10(Math.max(reflFactor, 1e-30));
}
