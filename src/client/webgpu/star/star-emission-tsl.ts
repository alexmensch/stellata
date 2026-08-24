// Fragment-stage pieces the star passes share: the kernel and its gates,
// chart mode's ink disc, starEmission()'s colour, and the MRT output
// struct + mode swap (../hdr/README.md § The gate becomes the struct).

import { Discard, If, float, length, max, select, smoothstep, vec3, vec4 } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';
import { PHYS_RATIO_THRESHOLD } from '../../star-pipeline/local-pass/star-local-cluster-pure';
import { maskedStatisticTexelTsl } from '../emission-tsl';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import { tonemapUnditheredTsl } from '../tonemap-tsl';
import {
  perceptualDiscExponentTsl,
  perceptualDiscProfileTsl,
} from '../perceptual-disc-tsl';
import type { StarVaryings } from './star-vertex-tsl';

/** The super-Gaussian kernel at this fragment: radius from vUv, exponent
 *  morphed on the per-instance softness and phys-ratio varyings. */
export function starGlowNode(u: SharedUniformNodes, v: StarVaryings) {
  const n = perceptualDiscExponentTsl(
    v.vSoftness, v.vPhysRatio, u.uDistNMin, u.uDistNMax, u.uLumBiasMin, u.uLumBiasMax);
  return perceptualDiscProfileTsl(length(v.vUv), n, u.uVisibleThreshold, u.uVisibleK);
}

/** Outside the quad's inscribed circle there is no star — the first
 *  discard of every star fragment, colour or depth-only, chart or not. */
export function discardOutsideKernel(v: StarVaryings) {
  Discard(length(v.vUv).greaterThan(0.5));
}

/**
 * The disc-pass entry gate, run by the disc draw AND the core mask before
 * either splits on render style.
 *
 * Those two fragment sets are one decision: the mask stamps the depth the
 * disc draw then reads without writing any of its own, so a test added to
 * one and not the other either stamps depth for a star that renders no
 * colour or leaves a core unstamped (README.md § The disc draw writes no
 * depth). Chart mode splits the same way on `vPhysRatio` — the disc/glow
 * pivot is a property of the star, not of the render style — which is why
 * this half sits outside the chart branch.
 */
export function discPassEntryGate(v: StarVaryings) {
  discardOutsideKernel(v);
  Discard(v.vPhysRatio.lessThan(PHYS_RATIO_THRESHOLD));
}

/**
 * The colour-mode remainder of that gate, and the kernel value behind it.
 * Shared by the disc draw and the core mask for the same reason
 * `discPassEntryGate` is.
 *
 * The taper band `(uThresholdMag, uThresholdMag + 0.5]` is glow-only: a
 * resolved disc at threshold would render as a sub-pixel speck and read as
 * a hard cutoff anyway.
 */
export function discPassKernel(u: SharedUniformNodes, v: StarVaryings) {
  Discard(v.vAppMag.greaterThan(u.uThresholdMag));
  return starGlowNode(u, v).toVar();
}

/**
 * Chart mode's ink coverage: a flat hard-edged disc filling the inscribed
 * circle, its outer pixel antialiased over `vAaWidth` (one CSS pixel in
 * vUv units, sized per quad in the vertex stage). No glow profile, no
 * halo, no luminosity-class softening — the magnitude-mapped quad size is
 * the only encoding of brightness.
 *
 * `uLimitMag` is the faint edge here rather than `uThresholdMag`: chart
 * inherits neither the scene adaptation nor the EV trim.
 */
export function chartDiscCoverage(u: SharedUniformNodes, v: StarVaryings) {
  Discard(v.vAppMag.greaterThan(u.uLimitMag));
  const aa = max(v.vAaWidth, 1e-3);
  const disc = float(1.0).sub(smoothstep(float(0.5).sub(aa), 0.5, length(v.vUv))).toVar();
  Discard(disc.lessThanEqual(0.0));
  return disc;
}

/** MultiplyBlending reads rgb = 1 as "leave the paper alone" and rgb = 0
 *  as "multiply toward black", so `1 − disc` paints solid ink with an
 *  antialiased outer pixel. */
export function chartInkColour(disc: Node<'float'>): Node<'vec4'> {
  return vec4(vec3(float(1.0).sub(disc)), 1.0);
}

/** vColor·vPeakL·glow as linear light on-target, through the undithered
 *  operator off-target; alpha stays the kernel value on both paths. */
export function starEmissionColour(
  u: SharedUniformNodes,
  v: StarVaryings,
  glow: Node<'float'>,
) {
  const emitted = v.vColor.mul(v.vPeakL.mul(glow));
  return select(
    u.uHdrTarget.greaterThan(0.5),
    vec4(emitted, glow),
    vec4(tonemapUnditheredTsl(emitted, u.uWhitePoint, u.uHighlightDesat), glow),
  );
}

export type StarColourMaterial = MrtEmitterMaterial;

/**
 * Give a colour pass both of its fragment graphs and the swap between
 * them, over the shared output-struct helper — and the chart branch, since
 * both colour passes carry the identical one.
 *
 * `entryGate` is the discard set both render styles share and runs ahead
 * of the branch; `colourKernel` is the pass's remaining colour-mode gates
 * plus its kernel, which the chart side needs none of. Chart is
 * non-photometric and bypasses the HDR seam, so its statistic texel is a
 * flat zero rather than a masked flux (../../hdr/README.md § Chart mode) —
 * and the diffuse slot stays at the blend's identity element on both
 * branches.
 *
 * Alpha 1 on the statistic attachment: one blend equation runs over every
 * attachment, so the glow pass's SrcAlpha factor would scale the flux
 * channel a second time and its integral would come out short.
 */
export function finishStarColourMaterial(
  material: NodeMaterial,
  u: SharedUniformNodes,
  v: StarVaryings,
  gates: EmitterGateNodes,
  entryGate: () => void,
  colourKernel: () => Node<'float'>,
): StarColourMaterial {
  return finishMrtMaterial(material, () => {
    entryGate();
    const colour = vec4(0.0).toVar();
    const statistic = vec4(0.0).toVar();
    If(u.uMonochrome.greaterThan(0.5), () => {
      colour.assign(chartInkColour(chartDiscCoverage(u, v)));
    }).Else(() => {
      const glow = colourKernel();
      colour.assign(starEmissionColour(u, v, glow));
      statistic.assign(maskedStatisticTexelTsl(
        gates.statisticWrites, v.vFluxPeakL.mul(glow), 0.0, 1.0));
    });
    return { colour, statistic, diffuse: vec4(0.0) };
  });
}
