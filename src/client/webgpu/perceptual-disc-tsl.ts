// TSL mirror of the stellata_perceptual_disc chunk: dM soft knee, √Δm
// disc size, super-Gaussian exponent + profile. Thin composition over
// ../star-pipeline/perceptual-disc/perceptual-disc-pure.ts, which carries the math.

import { Fn, exp, float, max, mix, pow, select, smoothstep, sqrt } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { PHYS_RATIO_THRESHOLD } from '../star-pipeline/local-pass/star-local-cluster-pure';
import { DM_KNEE_FLOOR, SIZE_SPAN_FLOOR } from '../star-pipeline/perceptual-disc/perceptual-disc-pure';
import { KERNEL_FLUX_FIT } from '../star-pipeline/perceptual-disc/perceptual-disc-flux-pure';

type NF = Node<'float'>;

export const perceptualDmEffTsl = /* @__PURE__ */ Fn(
  ([appMag, limitMag, sizeSpan, sizeKnee]: [NF, NF, NF, NF]) => {
    const dM = limitMag.sub(appMag);
    const over = dM.sub(sizeSpan);
    const soft = sizeSpan.add(
      sizeKnee.mul(over).div(max(sizeKnee.add(over), DM_KNEE_FLOOR)));
    return select(dM.lessThanEqual(sizeSpan), max(dM, 0.0), soft);
  },
);

export const perceptualAppSizePxTsl = /* @__PURE__ */ Fn(
  ([dMEff, sizeMin, sizeMax, sizeSpan]: [NF, NF, NF, NF]) =>
    mix(sizeMin, sizeMax, sqrt(dMEff.div(max(sizeSpan, SIZE_SPAN_FLOOR)))),
);

export const perceptualDiscExponentTsl = /* @__PURE__ */ Fn(
  ([softness, physRatio, distNMin, distNMax, lumBiasMin, lumBiasMax]: [NF, NF, NF, NF, NF, NF]) => {
    const distN = mix(distNMin, distNMax, smoothstep(0.0, PHYS_RATIO_THRESHOLD, physRatio));
    const lumBias = mix(lumBiasMin, lumBiasMax, softness);
    return distN.mul(lumBias);
  },
);

/** The kernel's area integral Φ(n) over its own quad — Horner over the
 *  same degree-4 fit the CPU mirror and the GLSL chunk run
 *  (../../star-pipeline/perceptual-disc/perceptual-disc-flux-pure.ts). */
export const perceptualDiscFluxIntegralTsl = /* @__PURE__ */ Fn(([n]: [NF]) => {
  const x = float(1.0).div(max(n, 1e-6));
  let acc: Node<'float'> = float(KERNEL_FLUX_FIT[KERNEL_FLUX_FIT.length - 1]);
  for (let i = KERNEL_FLUX_FIT.length - 2; i >= 0; i--) {
    acc = acc.mul(x).add(KERNEL_FLUX_FIT[i]);
  }
  return acc;
});

/** The profile from a pre-derived exponent — the GLSL overload derives
 *  `n` inline; TSL callers reuse the exponent node instead. */
export const perceptualDiscProfileTsl = /* @__PURE__ */ Fn(
  ([r, n, visibleThreshold, visibleK]: [NF, NF, NF, NF]) => {
    const raw = exp(visibleK.negate().mul(pow(r.mul(2.0), n)));
    return max(0.0, raw.sub(visibleThreshold).div(float(1.0).sub(visibleThreshold)));
  },
);
