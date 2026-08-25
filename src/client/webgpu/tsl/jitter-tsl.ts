// Interleaved gradient noise over the fragment position. See README.md
// § Interleaved gradient noise.

import { Fn, dot, fract, vec2 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { DITHER_IGN_DOT, DITHER_IGN_SCALE } from '../../hdr/tonemap-pure';

type N2 = Node<'vec2'>;

/**
 * Static per pixel and never reseeded per frame — animated jitter
 * shimmers (`docs/science-molecular-clouds.md` § 9.1 rules 3–4).
 *
 * One shape, two jobs: the ray-start offset that turns a few-sample
 * lattice into fine grain, and the ±0.5-LSB output dither that stops a
 * whisper-level gradient banding on 8-bit.
 */
export const interleavedGradientNoiseTsl = /* @__PURE__ */ Fn(
  ([fragCoord]: [N2]) =>
    fract(fract(dot(fragCoord, vec2(...DITHER_IGN_DOT))).mul(DITHER_IGN_SCALE)),
);
