// Interleaved gradient noise over the fragment position, and the output
// dither it also serves. See README.md § Interleaved gradient noise.

import { Fn, dot, fract, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import {
  DITHER_IGN_DOT, DITHER_IGN_SCALE, DITHER_LSB_LEVELS,
} from '../../hdr/tonemap/tonemap-pure';

type N2 = Node<'vec2'>;

/** Static per pixel — never reseed it per frame (README.md § Interleaved
 *  gradient noise). */
export const interleavedGradientNoiseTsl = /* @__PURE__ */ Fn(
  ([fragCoord]: [N2]) =>
    fract(fract(dot(fragCoord, vec2(...DITHER_IGN_DOT))).mul(DITHER_IGN_SCALE)),
);

/**
 * The ±0.5-LSB output dither: the same noise, centred and scaled to one
 * 8-bit step. Offset the fragment position by `DITHER_SEED_OFFSET` where
 * the caller also jitters a ray start off the noise above.
 */
export const lsbDitherTsl = /* @__PURE__ */ Fn(
  ([fragCoord]: [N2]) =>
    interleavedGradientNoiseTsl(fragCoord).sub(0.5).div(DITHER_LSB_LEVELS),
);
