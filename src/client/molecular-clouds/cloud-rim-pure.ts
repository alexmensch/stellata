// The rim shell's authored constants. The graph imports them, so no
// mirror can drift from this module.

import { rimDistancesForExtent } from '../fresnel-shell/shell-distance-pure';

/** One representative cloud radius (pc) standing in for the per-cloud
 *  extent: a single rim material serves all ~96 clouds, so the near-fade
 *  reach cannot vary per cloud. The named SF clouds run ~1–50 pc. */
export const CLOUD_RIM_EXTENT_PC = 20;

/** The cloud rim's two camera-distance reaches, off the representative
 *  extent above rather than authored, so neither is a third scale. */
export const CLOUD_RIM_DISTANCES = rimDistancesForExtent(CLOUD_RIM_EXTENT_PC);

/** CSS pixels. */
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
