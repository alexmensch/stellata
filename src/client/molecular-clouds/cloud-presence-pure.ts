// CPU mirror of the absorption-pass math in cloud-absorption.frag.glsl:
// Plummer density and absorption alpha. Physics: docs/molecular-clouds.md
// §§ 2, 4, 9.

/** τ_V = 0.921 · A_V (A_V = 1.086 τ_V). */
export const TAU_PER_AV = 0.921;

/** A_V rate [mag/pc] per n_H [cm⁻³] (docs/molecular-clouds.md § 2). */
export const AV_RATE_PER_NH = 1.65e-3;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Calibrated Plummer density [cm⁻³] at ellipsoidal radius `u`
 * (docs/molecular-clouds.md § 4.1): profile radius is `u · sMin`, the
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
  const envelope = 1 - smoothstep(0.85 * uEnv, uEnv, u);
  if (envelope <= 0) return 0;
  const q = (u * sMinPc) / rflatPc;
  return n0Cal * (1 + q * q) ** (-p / 2) * envelope;
}

/** Absorption opacity from a raymarched A_V column (§ 9): capped so the
 *  densest core never fully blacks out the background. */
export function absorptionAlpha(av: number): number {
  return Math.min(1 - Math.exp(-TAU_PER_AV * av), 0.95);
}
