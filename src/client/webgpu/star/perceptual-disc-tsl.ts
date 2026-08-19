// TSL mirror of the stellata_perceptual_disc chunk: dM soft knee, √Δm
// disc size, super-Gaussian exponent + profile. The chunk's header
// (../../star-pipeline/perceptual-disc.glsl) carries the math.

import { Fn, exp, float, max, mix, pow, select, smoothstep, sqrt } from 'three/tsl';
import type { Node } from 'three/webgpu';

type NF = Node<'float'>;

export const perceptualDmEffTsl = /* @__PURE__ */ Fn(
  ([appMag, limitMag, sizeSpan, sizeKnee]: [NF, NF, NF, NF]) => {
    const dM = limitMag.sub(appMag);
    const over = dM.sub(sizeSpan);
    const soft = sizeSpan.add(sizeKnee.mul(over).div(max(sizeKnee.add(over), 1e-6)));
    return select(dM.lessThanEqual(sizeSpan), max(dM, 0.0), soft);
  },
);

export const perceptualAppSizePxTsl = /* @__PURE__ */ Fn(
  ([dMEff, sizeMin, sizeMax, sizeSpan]: [NF, NF, NF, NF]) =>
    mix(sizeMin, sizeMax, sqrt(dMEff.div(max(sizeSpan, 0.001)))),
);

export const perceptualDiscExponentTsl = /* @__PURE__ */ Fn(
  ([softness, physRatio, distNMin, distNMax, lumBiasMin, lumBiasMax]: [NF, NF, NF, NF, NF, NF]) => {
    const distN = mix(distNMin, distNMax, smoothstep(0.0, 0.5, physRatio));
    const lumBias = mix(lumBiasMin, lumBiasMax, softness);
    return distN.mul(lumBias);
  },
);

/** The profile from a pre-derived exponent — the GLSL overload derives
 *  `n` inline; TSL callers reuse the exponent node instead. */
export const perceptualDiscProfileTsl = /* @__PURE__ */ Fn(
  ([r, n, visibleThreshold, visibleK]: [NF, NF, NF, NF]) => {
    const raw = exp(visibleK.negate().mul(pow(r.mul(2.0), n)));
    return max(0.0, raw.sub(visibleThreshold).div(float(1.0).sub(visibleThreshold)));
  },
);
