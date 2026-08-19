// TSL mirror of the stellata_tonemap chunk's undithered operator. Thin
// composition over tonemap-pure's constants (README.md § TSL test
// pattern); tonemap-pure.ts carries the math and its tests.

import {
  Fn, clamp, dot, exp, float, log2, max, mix, pow, select, vec3,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import { L_THRESH, LUMA_WEIGHTS, TOE_CURVATURE } from '../hdr/tonemap-pure';
import { mix as mixVecT, step } from './tsl-shim';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

const MAG_PER_LOG2 = 2.5 * Math.log10(2);

export const lumaWeightsTsl = () => vec3(...LUMA_WEIGHTS);

export const srgbEncodeTsl = /* @__PURE__ */ Fn(([c]: [N3]) => {
  const v = clamp(c, vec3(0.0), vec3(1.0));
  const encoded = pow(v, vec3(1.0 / 2.4)).mul(1.055).sub(0.055);
  return mixVecT(v.mul(12.92), encoded, step(vec3(0.0031308), v));
});

export const tonemapUnditheredTsl = /* @__PURE__ */ Fn(
  ([hdr, whitePoint, desat]: [N3, NF, NF]) => {
    const y = dot(hdr, lumaWeightsTsl());
    // The toe must stay finite at y = 0: it feeds the mapped branch, and
    // TSL builds a node where it is first referenced rather than where the
    // GLSL's early-out would have skipped it.
    const ySafe = max(y, 1e-9);
    const magsUnder = log2(float(L_THRESH).div(ySafe)).mul(MAG_PER_LOG2);
    const toe = select(
      y.greaterThanEqual(L_THRESH),
      y,
      pow(ySafe.div(L_THRESH), magsUnder.mul(TOE_CURVATURE).add(1.0)).mul(L_THRESH),
    );
    const yd = toe.mul(toe.div(whitePoint.mul(whitePoint)).add(1.0)).div(toe.add(1.0));
    const white = float(1.0).sub(exp(desat.negate().mul(max(y.div(whitePoint).sub(1.0), 0.0))));
    const mapped = mix(hdr.mul(yd.div(ySafe)), vec3(yd), white);
    return select(y.lessThanEqual(0.0), vec3(0.0), srgbEncodeTsl(mapped));
  },
);
