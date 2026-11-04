// CPU mirror of the absorption-pass math in ../../webgpu/molecular-clouds/cloud-absorption-tsl.ts:
// Plummer density and absorption alpha. Physics: /docs/science-molecular-clouds.md#2-extinction-physics-and-the-units-chain,
// /docs/science-molecular-clouds.md#4-per-cloud-density-model--the-presence-pass-field, /docs/science-molecular-clouds.md#9-presence-pass.

import { cloudEnvelope, plummerProfile } from '../../../astro-core/cloud-density-pure';

/** τ_V = 0.921 · A_V (A_V = 1.086 τ_V). */
export const TAU_PER_AV = 0.921;

/** Opacity ceiling: the densest core never fully blacks out the
 *  background behind it. */
export const ALPHA_CAP = 0.95;

/** A_V column past which the cap has long saturated, so the march stops. */
export const AV_SATURATED = 6.0;

/** Step floor for the screen-adaptive budget: below this the jittered
 *  lattice reads as banding rather than grain. */
export const MARCH_MIN_STEPS = 4;

/** Unit-sphere t. Doubles as the divisor floor that keeps the step count
 *  finite on a grazing ray. */
export const MARCH_MIN_CHORD_T = 1e-6;

/**
 * Calibrated Plummer density [cm⁻³] at ellipsoidal radius `u`
 * (/docs/science-molecular-clouds.md#41-the-11-profiled-clouds-zucker-2021): profile radius is `u · sMin`, the
 * mass-budget envelope cuts smoothly at `uEnv`.
 */
export function cloudModelDensity(
  u: number,
  sMinPc: number,
  n0Cal: number,
  rflatPc: number,
  p: number,
  uEnv: number,
  envelopeFadeStart: number,
): number {
  const envelope = cloudEnvelope(u, uEnv, envelopeFadeStart);
  if (envelope <= 0) return 0;
  return n0Cal * plummerProfile(u * sMinPc, rflatPc, p) * envelope;
}

/** `av` is a raymarched A_V column (/docs/science-molecular-clouds.md#9-presence-pass). */
export function absorptionAlpha(av: number): number {
  return Math.min(1 - Math.exp(-TAU_PER_AV * av), ALPHA_CAP);
}
