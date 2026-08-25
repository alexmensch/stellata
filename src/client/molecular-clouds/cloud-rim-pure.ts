// The rim shell's authored constants, in the one place both shader
// backends read them from. GLSL cannot import, so its copies are pinned
// against these by cloud-glsl-drift.test.ts.

/** Chart-mode stipple period, in CSS pixels. */
export const STIPPLE_PERIOD_PX = 6.0;

/** Dot radius as a fraction of the stipple period. */
export const STIPPLE_DOT_RADIUS = 0.30;

/** Half-softening either side of the dot edge, in the same fraction. */
export const STIPPLE_DOT_SOFTNESS = 0.08;

/** Contour band half-width in units of `fwidth(n·v)` — a roughly constant
 *  pixel-width silhouette line across mesh curvature. */
export const CONTOUR_WIDTH = 2.0;

/** Below this the stippled contour contributes nothing worth a draw. */
export const STIPPLE_ALPHA_FLOOR = 0.003;

/** Floor on `fwidth(n·v)`. A facet with zero screen-space gradient would
 *  give a zero-width band and drop the contour entirely. */
export const MIN_FWIDTH = 1e-5;
