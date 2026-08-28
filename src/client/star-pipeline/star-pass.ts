// Star pass identities: the uRenderMode values of the WebGL2 materials
// and the compile-time specialization keys of the WebGPU pipelines.

import { isDiscDominant } from './local-pass/star-local-cluster-pure';

export const STAR_PASS_GLOW = 0;
export const STAR_PASS_DISC = 1;
export const STAR_PASS_CORE_MASK = 2;

export type StarPass =
  | typeof STAR_PASS_GLOW
  | typeof STAR_PASS_DISC
  | typeof STAR_PASS_CORE_MASK;

/** The two colour passes a star can be routed to. The core mask is not
 *  one — it draws a subset of the disc pass's stars. */
export type ColourPass = typeof STAR_PASS_GLOW | typeof STAR_PASS_DISC;

/** Which colour pass draws a star with these size terms. */
export function colourPassFor(appSizePx: number, physSizePx: number): ColourPass {
  return isDiscDominant(appSizePx, physSizePx) ? STAR_PASS_DISC : STAR_PASS_GLOW;
}

/** The disc/glow split read both ways for a star under an eclipse dim.
 *  Debug-panel instrumentation for a fault that is invisible on screen:
 *  the shaders route on `routed`, and `trap` marks the band where a
 *  dimmed `appSize` would have picked the other pass — which is where
 *  the three compilations used to disagree and discard the star from
 *  every one of them. `trap` is a smoke aid, NOT a live fault: past the
 *  undimmed-routing fix the star stays drawn right through it.
 *  ./README.md § Star rendering. */
export interface StarPassRouting {
  /** Solved from the undimmed quad — what every compilation agrees on. */
  routed: ColourPass;
  /** What a dimmed `appSize` would pick instead. */
  dimmed: ColourPass;
  trap: boolean;
  /** `vPhysRatio` as the vertex stages compute it: undimmed. */
  physRatio: number;
  appSizePx: number;
  physSizePx: number;
}

export function starPassRouting(
  appSizePx: number,
  physSizePx: number,
  dimmedAppSizePx: number,
): StarPassRouting {
  const routed = colourPassFor(appSizePx, physSizePx);
  const dimmed = colourPassFor(dimmedAppSizePx, physSizePx);
  return {
    routed,
    dimmed,
    trap: routed !== dimmed,
    physRatio: Math.min(physSizePx / Math.max(appSizePx, physSizePx, 0.001), 1),
    appSizePx,
    physSizePx,
  };
}
