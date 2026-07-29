// Distance-from-Sol fade curves: the far-field reveal and its inverse, the
// Sol-frame self-hide. See src/client/galactic/README.md § Distance fades.

/** Inner edge of the fade-in band (distance from Sol, parsecs). */
export const FADE_INNER_PC = 500;

/** Outer edge of the fade-in band (distance from Sol, parsecs). */
export const FADE_OUTER_PC = 5000;

/** Standard Hermite smoothstep — t² · (3 − 2t) with clamped edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export interface SolFrameFadeWindow {
  /** Camera distance from Sol, pc, at which opacity starts dropping. */
  innerPc: number;
  /** Camera distance from Sol, pc, at which opacity reaches zero. */
  outerPc: number;
}

/**
 * Opacity multiplier at `distFromSolPc` — 1 inside the window, 0 beyond it.
 * The inverse of the far-field reveal above: a layer that only describes the
 * sky *from Sol* must self-hide as the camera leaves the neighbourhood
 * rather than appear as the camera pulls back.
 */
export function solFrameFadeFactor(
  distFromSolPc: number,
  fadeWindow: SolFrameFadeWindow,
): number {
  // A degenerate window would make smoothstep divide by zero; step at the
  // window instead. Negated rather than `outerPc <= innerPc` so a NaN window
  // lands here too and hides the layer — smoothstep would pass NaN through as
  // an opacity that never reads as ≤ 0, leaving a Sol-frame layer drawn at
  // full strength from every distance.
  if (!(fadeWindow.outerPc > fadeWindow.innerPc)) {
    return distFromSolPc < fadeWindow.outerPc ? 1 : 0;
  }
  return 1 - smoothstep(fadeWindow.innerPc, fadeWindow.outerPc, distFromSolPc);
}
