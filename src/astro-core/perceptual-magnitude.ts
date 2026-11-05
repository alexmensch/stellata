// Apparent-magnitude math the star and planet vertex shaders use: the
// standard formula, the reflected-light model, and the mesh's disc surface
// brightness. The disc-size kernel is /src/client/star-pipeline/perceptual-disc/perceptual-disc-pure.ts.

import { ARCSEC_TO_RAD } from './astronomy-constants';

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

/** `m − M = 5·log10(d / 10 pc)`; undefined at `dPc` = 0. */
export function distanceModulus(dPc: number): number {
  return 5 * (Math.log10(dPc) - 1);
}

/**
 * Standard apparent-magnitude formula for an unobscured emitter.
 *
 * Floors `dPc` at 1e-30 so callers don't need to guard against zero
 * distances at the singular focal-star point — matches the glare graph's
 * behaviour exactly.
 */
export function apparentMagnitude(absmag: number, dPc: number): number {
  return absmag + distanceModulus(Math.max(dPc, 1e-30));
}

/** The inverse of `apparentMagnitude`, unfloored: the caller rules out `dPc` = 0. */
export function absoluteMagnitude(mag: number, dPc: number): number {
  return mag - distanceModulus(dPc);
}

/**
 * Mean surface brightness of a body's lit disc at full phase, in
 * mag/arcsec² — what the mesh emits through the scene-wide unit
 * (`/src/astro-core/emission/README.md#unit--what-an-emitting-layer-writes`).
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
    apparentMagnitude(hostAbsmag, dHpPc) +
    2.5 * Math.log10(Math.PI / (ARCSEC_TO_RAD * ARCSEC_TO_RAD * p))
  );
}

/** CPU mirror of /src/client/webgpu/solar-system/planet-glare-tsl.ts; takes no viewer→host
 *  distance — /src/client/solar-system/README.md#reflected-light-magnitude-model. */
export function planetApparentMagnitude(
  hostAbsmag: number,
  dVpPc: number,
  dHpPc: number,
  albedo: number,
  radiusPc: number,
  phaseFactor: number,
): number {
  const dVp = Math.max(dVpPc, 1e-30);
  const mHostAtPlanet = apparentMagnitude(hostAbsmag, dHpPc);
  const radRatio = radiusPc / dVp;
  const reflFactor = albedo * radRatio * radRatio * Math.max(phaseFactor, 0);
  return mHostAtPlanet - 2.5 * Math.log10(Math.max(reflFactor, 1e-30));
}
