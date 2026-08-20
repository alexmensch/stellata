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
