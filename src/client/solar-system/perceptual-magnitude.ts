// Apparent-magnitude math the star and planet vertex shaders use: the
// standard formula, the reflected-light model, and the mesh's disc surface
// brightness. The disc-size kernel is ../star-pipeline/perceptual-disc-pure.ts.

import { ARCSEC_TO_RAD } from '../util/astronomy-constants';

// Magnitudes past the just-visible threshold a body still renders: the
// fragment shaders fade it out over this soft taper rather than
// hard-cutting at `uThresholdMag`, so a body is drawn (and therefore
// pickable) while `appMag <= uThresholdMag + SOFT_TAPER_MARGIN_MAG`.
// Every CPU mirror that gates on "is this drawn?" — pick paths,
// orbit-walk LOD, eclipse LOD — reads this so the CPU cutoff can't drift
// from the shader's. Chart mode hard-clips at `uLimitMag` instead (no
// taper, and no exposure state); callers add the margin only in the
// non-chart path.
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
 * Reflected-light apparent magnitude of a planet seen by a viewer. CPU
 * mirror of the integrated formula in planets/glare/planet.vert.glsl.
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
 *   `lambertianPhaseFactor` / `empiricalPhaseFactor` from `phase-function.ts`.
 *
 * Distances and the reflectance product floor at 1e-30 to match the
 * shader's defensive clamps at the singular zero-distance point.
 */
/**
 * V-band apparent magnitude of the host **as seen from the body** — the
 * irradiance the host delivers there, on the magnitude scale.
 * `M_host + 5·(log10(d_hp) − 1)`. Folding the host's absolute magnitude is
 * what makes an O-class host light its bodies far brighter than Sol does at
 * the same distance.
 *
 * Deliberately independent of viewer distance: fixed for a given orbital
 * position, so nothing derived from it can blow out as the camera
 * approaches — the failure mode that rules out any viewer-distance term in
 * surface brightness.
 */
export function hostIrradianceMagnitude(hostAbsmag: number, dHpPc: number): number {
  return hostAbsmag + 5 * (Math.log10(Math.max(dHpPc, 1e-30)) - 1);
}

/**
 * Mean surface brightness of a body's lit disc at full phase, in
 * mag/arcsec² — what the mesh emits through the scene-wide unit
 * (`../hdr/emission/README.md` § Unit).
 *
 * Both the body's radius and the viewer distance cancel out of
 * `m_disc + 2.5·log10(Ω_disc)`, leaving host irradiance and geometric
 * albedo: surface brightness is distance-invariant, so a body does not
 * brighten per-pixel as the camera closes in.
 *
 * ```
 * S₀ = m_host@body + 2.5·log10( π / (ARCSEC_TO_RAD² · p) )
 * ```
 *
 * Full-Moon check (`m_host@body` = −26.74, p = 0.12): +3.4 mag/arcsec²,
 * the measured value — vitest-pinned alongside the −12.7 flux anchor.
 *
 * `phaseFactor` is deliberately absent: the mesh's own Lambert terminator
 * redistributes light across the disc and integrates to φ(α) on its own,
 * so folding φ here would count the phase twice.
 */
export function bodySurfaceBrightnessMagArcsec2(
  hostAbsmag: number,
  dHpPc: number,
  albedo: number,
): number {
  const p = Math.max(albedo, 1e-30);
  return (
    hostIrradianceMagnitude(hostAbsmag, dHpPc) +
    2.5 * Math.log10(Math.PI / (ARCSEC_TO_RAD * ARCSEC_TO_RAD * p))
  );
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
