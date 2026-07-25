// Live camera-motion config: shipping values from `timing.ts`, mutable
// by the warp-tuning debug panel. See src/client/camera/README.md
// § Shipping config vs debug panel.

import {
  type ArrivalCurveContext,
  resolveHybridCurve,
} from './arrival/arrival-curves';
import {
  OBSERVE_TRANSITION_MS,
  WARP_REORIENT_MS,
  WARP_T_K_MS,
  WARP_T_MAX_MS,
  WARP_T_MIN_MS,
} from './timing';

/** Hybrid-curve seam distance multiplier: `d_seam = seamK · parkDist`.
 *  `seamK ≤ 1` degenerates to pure outer (linear-d piecewise-quad). */
export const ARRIVAL_HYBRID_SEAM_K = 100;

/** Linear `|camera−B| / |A−B|` threshold at which the mid-Fly recentre
 *  fires (0.5 = trajectory midpoint). The comparison site squares it, so
 *  the value reads as the fraction of the way along the trajectory. */
export const MID_FLY_RECENTRE_FRAC = 0.5;

export interface CameraConfig {
  reorientMs: number;
  flyTMinMs: number;
  flyTMaxMs: number;
  flyTKMs: number;
  observeTransitionMs: number;
  arrivalHybridSeamK: number;
  midFlyRecentreFrac: number;
}

const config: CameraConfig = {
  reorientMs: WARP_REORIENT_MS,
  flyTMinMs: WARP_T_MIN_MS,
  flyTMaxMs: WARP_T_MAX_MS,
  flyTKMs: WARP_T_K_MS,
  observeTransitionMs: OBSERVE_TRANSITION_MS,
  arrivalHybridSeamK: ARRIVAL_HYBRID_SEAM_K,
  midFlyRecentreFrac: MID_FLY_RECENTRE_FRAC,
};

/** Read inside `startWarp` / `tryMidFlyRecentre` / the focus-park and
 *  unfocus entry points — NEVER cached module-side, or a panel edit
 *  stops reaching the next animation. */
export function cameraConfig(): Readonly<CameraConfig> {
  return config;
}

export function setCameraConfig<K extends keyof CameraConfig>(
  key: K,
  value: CameraConfig[K],
): void {
  config[key] = value;
}

/** Resolve the arrival curve against the live seam multiplier. Called at
 *  animation start so an in-flight arrival keeps the curve it launched
 *  with. */
export function arrivalEaseFn(
  ctx?: ArrivalCurveContext,
): (u: number) => number {
  return resolveHybridCurve(config.arrivalHybridSeamK, ctx);
}
