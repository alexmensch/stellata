// CPU mirror of the absorption-pass math in cloud-absorption.frag.glsl:
// Plummer density and absorption alpha. Physics: docs/science-molecular-clouds.md
// §§ 2, 4, 9.

/** τ_V = 0.921 · A_V (A_V = 1.086 τ_V). */
export const TAU_PER_AV = 0.921;

/** A_V rate [mag/pc] per n_H [cm⁻³] (docs/science-molecular-clouds.md § 2). */
export const AV_RATE_PER_NH = 1.65e-3;

/** Opacity ceiling: the densest core never fully blacks out the
 *  background behind it. */
export const ALPHA_CAP = 0.95;

/** A_V column past which the cap has long saturated, so the march stops. */
export const AV_SATURATED = 6.0;

/** A_V per E_ZGR — the dust manifest's avPerDensityPerPc. Traced clouds
 *  only; the analytic tier goes through AV_RATE_PER_NH instead. */
export const AV_PER_DENSITY = 2.742;

/** Where the mass-budget envelope starts tapering, as a fraction of
 *  `uEnv`. */
export const ENVELOPE_TAPER_FRAC = 0.85;

/** Step floor for the screen-adaptive budget: below this the jittered
 *  lattice reads as banding rather than grain. */
export const MARCH_MIN_STEPS = 4;

/** Shortest chord worth marching, in unit-sphere t. Doubles as the divisor
 *  floor that keeps the step count finite on a grazing ray. */
export const MARCH_MIN_CHORD_T = 1e-6;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Calibrated Plummer density [cm⁻³] at ellipsoidal radius `u`
 * (docs/science-molecular-clouds.md § 4.1): profile radius is `u · sMin`, the
 * mass-budget envelope cuts smoothly at `uEnv`.
 */
export function cloudModelDensity(
  u: number,
  sMinPc: number,
  n0Cal: number,
  rflatPc: number,
  p: number,
  uEnv: number,
): number {
  const envelope = 1 - smoothstep(ENVELOPE_TAPER_FRAC * uEnv, uEnv, u);
  if (envelope <= 0) return 0;
  const q = (u * sMinPc) / rflatPc;
  return n0Cal * (1 + q * q) ** (-p / 2) * envelope;
}

/** Absorption opacity from a raymarched A_V column (§ 9). */
export function absorptionAlpha(av: number): number {
  return Math.min(1 - Math.exp(-TAU_PER_AV * av), ALPHA_CAP);
}
