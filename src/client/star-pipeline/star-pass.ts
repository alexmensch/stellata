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
  /** What the star's current dim would pick instead. */
  dimmed: ColourPass;
  trap: boolean;
  /** `vPhysRatio` as the vertex stages compute it: undimmed. */
  physRatio: number;
  /** The dim this star would have to reach to enter the trap band, or
   *  null when no dim can take it there. Null covers both dead ends, and
   *  they are not the same vantage problem: a disc-routed star
   *  (`routed === STAR_PASS_DISC`) ignores the dim entirely and the
   *  camera has to back off, while a deeply glow-dominated one is simply
   *  too far for even totality to shrink its quad past the split. */
  trapBelowDim: number | null;
  /** The `physRatio` this star would have to reach for its CURRENT dim
   *  to tier it disc-owned — i.e. where to put the camera, rather than
   *  how deep to scrub. A dim shrinks `appSize` by some factor k, and
   *  the split then flips at `physRatio ≥ k/2`, so this is exactly k/2.
   *  Meaningless for a disc-routed star, which ignores the dim. */
  needRatio: number;
}

/** Bisection depth: `DIM_FLOOR`..1 to within ~1e-6, which is finer than
 *  the readout prints and costs nothing off the render path. */
const TRAP_SOLVE_STEPS = 20;

export function starPassRouting(
  appSizePx: number,
  physSizePx: number,
  dim: number,
  dimFloor: number,
  appSizeAtDim: (dim: number) => number,
): StarPassRouting {
  const routed = colourPassFor(appSizePx, physSizePx);
  const dimmed = colourPassFor(appSizeAtDim(dim), physSizePx);

  // A dim only ever shrinks appSize, so "is disc-routed at this dim" is
  // monotone: true everywhere below one threshold. Bisect for it, and
  // only when the star is glow-routed now and totality would flip it —
  // otherwise there is no crossing in range to find.
  let trapBelowDim: number | null = null;
  if (routed === STAR_PASS_GLOW
    && colourPassFor(appSizeAtDim(dimFloor), physSizePx) === STAR_PASS_DISC) {
    let lo = dimFloor;
    let hi = 1;
    for (let i = 0; i < TRAP_SOLVE_STEPS; i++) {
      const mid = 0.5 * (lo + hi);
      if (colourPassFor(appSizeAtDim(mid), physSizePx) === STAR_PASS_DISC) lo = mid;
      else hi = mid;
    }
    trapBelowDim = lo;
  }

  return {
    routed,
    dimmed,
    trap: routed !== dimmed,
    physRatio: Math.min(physSizePx / Math.max(appSizePx, physSizePx, 0.001), 1),
    needRatio: 0.5 * appSizeAtDim(dim) / Math.max(appSizePx, 0.001),
    trapBelowDim,
  };
}
