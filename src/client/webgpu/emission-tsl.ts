// TSL mirrors of stellata_hdr_emission's point-source peak, flux-peak
// and statistic-texel rules, over emission-pure's constants. Contracts:
// ../hdr/emission/README.md § Unit, ../hdr/attachments/README.md § The unit.

import { Fn, clamp, dot, float, log2, max, min, pow, sqrt, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { ARCSEC_TO_RAD } from '../util/astronomy-constants';
import { FOOTPRINT_SQRT12, LUMA_CEIL, MAG_PER_STOP } from '../hdr/emission/emission-pure';

type NF = Node<'float'>;
type N3 = Node<'vec3'>;

export const luminanceForMagTsl = /* @__PURE__ */ Fn(
  ([exposure, appMag]: [NF, NF]) => exposure.mul(pow(10.0, appMag.mul(-0.4))),
);

/**
 * The extended-source rule: the flux magnitude inside a solid angle Ω is
 * `S − 2.5·log10(Ω)`, and the log round-trip collapses to one scalar gain.
 *
 * **Unclamped by contract** — being a single scalar is what lets a layer
 * apply it to a coloured column without touching chromaticity, so the
 * CALLER clamps the product rather than the factor
 * (`../hdr/emission/README.md` § Unit).
 */
export const surfaceBrightnessLuminanceTsl = /* @__PURE__ */ Fn(
  ([exposure, magPerArcsec2, omegaArcsec2]: [NF, NF, NF]) =>
    luminanceForMagTsl(exposure, magPerArcsec2).mul(omegaArcsec2),
);

/** CSS px per radian recovered from the pixel solid angle — the inverse of
 *  `pixelSolidAngleArcsec2`. A layer needing a plate scale takes it from
 *  `uOmegaPxArcsec2` through this rather than carrying a second uniform, so
 *  a resize can never leave the two disagreeing about the viewport. */
export const pxPerRadianTsl = /* @__PURE__ */ Fn(
  ([omegaPxArcsec2]: [NF]) =>
    sqrt(max(omegaPxArcsec2, 1e-12)).mul(ARCSEC_TO_RAD).reciprocal(),
);

/** Radius, in pc, over which a raymarch step must smooth its profile for a
 *  point-sampled fragment to carry the pixel's AREA average of the column.
 *  Grows along the ray, so it is a cone rather than a cylinder. */
export const footprintPcTsl = /* @__PURE__ */ Fn(
  ([distancePc, omegaPxArcsec2]: [NF, NF]) =>
    distancePc.div(pxPerRadianTsl(omegaPxArcsec2).mul(FOOTPRINT_SQRT12)),
);

/** A profile radius smoothed over the footprint — exactly TRANSVERSE
 *  smoothing for a spherically symmetric profile. */
export const softenRadiusTsl = /* @__PURE__ */ Fn(
  ([radiusPc, footprintPc]: [NF, NF]) =>
    sqrt(radiusPc.mul(radiusPc).add(footprintPc.mul(footprintPc))),
);

/** The extended-source threshold surface brightness recovered from the rod
 *  summation solid angle — the inverse of `rodSummationSolidAngleArcsec2`.
 *  Its one caller is the band's chart-isobar branch, which has never drawn
 *  (`../milkyway/README.md`); taking threshold off the same solid angle the
 *  gain runs on is what would keep contour and emission agreeing on it. */
export const extendedThresholdSbTsl = /* @__PURE__ */ Fn(
  ([omegaSummationArcsec2, limitMag]: [NF, NF]) =>
    limitMag.add(log2(max(omegaSummationArcsec2, 1e-12)).mul(MAG_PER_STOP)),
);

/** How much of the footprint lies along `axis` for a ray running `dirUnit`.
 *  Zero when the ray runs along the axis, which is what a separable profile
 *  needs: softening a face-on disc along z would suppress the column
 *  instead of averaging it. */
export const footprintAlongTsl = /* @__PURE__ */ Fn(
  ([dirUnit, axis]: [N3, N3]) => {
    const c = dot(dirUnit, axis);
    return sqrt(max(float(1.0).sub(c.mul(c)), 0.0));
  },
);

export const pointSourcePeakTsl = /* @__PURE__ */ Fn(
  ([exposure, appMag, physRadiusPx]: [NF, NF, NF]) => {
    const spread = max(1.0, physRadiusPx.mul(physRadiusPx).mul(Math.PI));
    return min(luminanceForMagTsl(exposure, appMag).div(spread), LUMA_CEIL);
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
    return min(luminanceForMagTsl(exposure, appMag).div(max(area, 1e-9)), LUMA_CEIL);
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
