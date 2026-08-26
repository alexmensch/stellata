// The display floor under which a glow star's kernel collapses to the
// statistic footprint — the vertex-stage twin of the pick path's
// half-step visibility test. See README.md.

import {
  EIGHT_BIT_STEP_L,
  faintToeInverse,
  reinhardExtendedInverse,
  tonemapWhitePoint,
} from '../../hdr/tonemap/tonemap-pure';

/** How many collapsed stars may stack on one pixel before their summed
 *  display light could reach the half-step the floor was derived from.
 *  A linear-luminance margin, so it bounds additive stacking directly. */
export const GLOW_COLLAPSE_STACK_MARGIN = 16;

/** The peak display luminance whose tone-mapped output is half an 8-bit
 *  step — the darkest level the encode distinguishes from black. The
 *  operator's exact inverse at that step; whitePoint-independent to first
 *  order, since the Reinhard is near-identity that far under threshold. */
export function glowCollapseHalfStepL(whitePoint = tonemapWhitePoint()): number {
  return faintToeInverse(reinhardExtendedInverse(EIGHT_BIT_STEP_L, whitePoint));
}

/** The vertex-stage collapse floor the star shaders compare
 *  `vPeakL · tap²` against (the glow pass's additive alpha squares the
 *  kernel, so that product IS the peak display light).
 *  `star.vert.glsl` duplicates the value as
 *  `STELLATA_GLOW_COLLAPSE_FLOOR_L` — glow-collapse-pure.test.ts pins the
 *  literal; the TSL vertex imports this constant directly. */
export const GLOW_COLLAPSE_FLOOR_L =
  glowCollapseHalfStepL() / GLOW_COLLAPSE_STACK_MARGIN;
