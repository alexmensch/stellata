// TSL mirrors of stellata_hdr_emission's point-source peak, flux-peak
// and statistic-texel rules, over emission-pure's constants. Contracts:
// ../hdr/emission/README.md § Unit, ../hdr/attachments/README.md § The unit.

import { Fn, clamp, max, min, pow, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { LUMA_CEIL } from '../hdr/emission/emission-pure';

type NF = Node<'float'>;

export const pointSourcePeakTsl = /* @__PURE__ */ Fn(
  ([exposure, appMag, physRadiusPx]: [NF, NF, NF]) => {
    const flux = exposure.mul(pow(10.0, appMag.mul(-0.4)));
    const spread = max(1.0, physRadiusPx.mul(physRadiusPx).mul(Math.PI));
    return min(flux.div(spread), LUMA_CEIL);
  },
);

/** The display kernel renormalised to carry the source's true FLUX — the
 *  statistic's channel. Divides by the kernel's own area integral
 *  `fluxIntegral · D²` (perceptualDiscFluxIntegralTsl) and clamps like
 *  the peak: a clamped read is a lower bound the adaptation loop closes
 *  from above. */
export const kernelFluxPeakTsl = /* @__PURE__ */ Fn(
  ([exposure, appMag, quadDiameterPx, fluxIntegral]: [NF, NF, NF, NF]) => {
    const area = fluxIntegral.mul(quadDiameterPx).mul(quadDiameterPx);
    const flux = exposure.mul(pow(10.0, appMag.mul(-0.4)));
    return min(flux.div(max(area, 1e-9)), LUMA_CEIL);
  },
);

/** One texel of the statistic attachment: flux-correct luminance in R,
 *  the lit-resolved-surface mask in G. `alpha` must be whatever the same
 *  fragment writes to attachment 0 — one blend state runs over every
 *  attachment (../hdr/attachments/README.md § One blend equation). */
export const statisticTexelTsl = /* @__PURE__ */ Fn(
  ([fluxL, litSurface, alpha]: [NF, NF, NF]) =>
    vec4(min(fluxL, LUMA_CEIL), clamp(litSurface, 0.0, 1.0), 0.0, alpha),
);

/**
 * The statistic texel under the frame's write gate.
 *
 * The WebGL build masks attachment 1 off with `drawBuffers`; here the whole
 * texel scales to zero instead, which is the blend's identity for every
 * writer of that attachment — additive leaves the destination because the
 * source is zero, and an alpha-composited one leaves it because the alpha
 * went to zero with the rest. Masking the flux alone would be wrong for the
 * second class: it would keep compositing `dst · (1 − alpha)`.
 */
export const maskedStatisticTexelTsl = /* @__PURE__ */ Fn(
  ([gate, fluxL, litSurface, alpha]: [NF, NF, NF, NF]) =>
    statisticTexelTsl(fluxL, litSurface, alpha).mul(gate),
);

/** One texel of the diffuse attachment for a fragment adding no diffuse
 *  light but standing in front of some. `alpha` MUST be the alpha the same
 *  fragment writes to attachment 0, or the object dims the band by a
 *  different amount than it dims everything else
 *  (../hdr/attachments/README.md § The gate). */
export const occluderTexelTsl = /* @__PURE__ */ Fn(
  ([alpha]: [NF]) => vec4(0.0, 0.0, 0.0, alpha),
);
