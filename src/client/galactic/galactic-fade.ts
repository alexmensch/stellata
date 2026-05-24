// Shared distance-from-Sol fade curve for far-field reference geometry
// (galactic disc, Local Group wireframe). See
// src/client/galactic/README.md.

/** Inner edge of the fade-in band (distance from Sol, parsecs). */
export const FADE_INNER_PC = 500;

/** Outer edge of the fade-in band (distance from Sol, parsecs). */
export const FADE_OUTER_PC = 5000;

/** Standard Hermite smoothstep — t² · (3 − 2t) with clamped edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
