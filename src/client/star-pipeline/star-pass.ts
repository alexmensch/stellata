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

/** Which colour pass draws a star with these size terms. The core mask is
 *  not a colour pass — it draws a subset of the disc pass's stars. */
export function colourPassFor(
  appSizePx: number,
  physSizePx: number,
): typeof STAR_PASS_GLOW | typeof STAR_PASS_DISC {
  return isDiscDominant(appSizePx, physSizePx) ? STAR_PASS_DISC : STAR_PASS_GLOW;
}
