// Fragment-stage pieces the star colour passes share: the kernel and its
// gates, starEmission()'s colour output, and the MRT output struct + mode
// swap (../hdr/README.md § The gate becomes the output struct).

import { Discard, length, select, vec4 } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';
import { PHYS_RATIO_THRESHOLD } from '../../star-pipeline/local-pass/star-local-cluster-pure';
import { maskedStatisticTexelTsl } from '../emission-tsl';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
import {
  finishMrtMaterial, type EmitterOutputs, type MrtEmitterMaterial,
} from '../hdr/mrt-material';
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
 *  discard of every star fragment, colour or depth-only. */
export function discardOutsideKernel(v: StarVaryings) {
  Discard(length(v.vUv).greaterThan(0.5));
}

/**
 * The disc pass's fragment gate, and the kernel value behind it.
 *
 * The core-mask draw runs this same gate and stamps the depth the disc
 * draw then reads without writing any of its own, so the two fragment
 * sets are one decision: a test added here and not there stamps depth
 * for a star that renders no colour, and a test added there and not here
 * leaves a core unstamped. README.md § The disc draw writes no depth.
 *
 * The taper band `(uThresholdMag, uThresholdMag + 0.5]` is glow-only: a
 * resolved disc at threshold would render as a sub-pixel speck and read
 * as a hard cutoff anyway.
 */
export function discPassKernel(u: SharedUniformNodes, v: StarVaryings) {
  discardOutsideKernel(v);
  Discard(v.vPhysRatio.lessThan(PHYS_RATIO_THRESHOLD));
  Discard(v.vAppMag.greaterThan(u.uThresholdMag));
  return starGlowNode(u, v).toVar();
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

/** The three-attachment output of a star colour draw: colour, the
 *  statistic texel (no coverage claim — stars draw a kernel; alpha 1 so
 *  the glow blend's SrcAlpha factor cannot scale the flux a second
 *  time), and the diffuse slot's identity element in place of the WebGL
 *  gate's NONE. The park/frame-cost mask scales the whole statistic texel
 *  to that identity (../hdr/README.md § The gate becomes the output
 *  struct). */
export function starMrtOutputs(
  u: SharedUniformNodes,
  v: StarVaryings,
  glow: Node<'float'>,
  gates: EmitterGateNodes,
): EmitterOutputs {
  return {
    colour: starEmissionColour(u, v, glow),
    statistic: maskedStatisticTexelTsl(
      gates.statisticWrites, v.vFluxPeakL.mul(glow), 0.0, 1.0),
    diffuse: vec4(0.0),
  };
}

export type StarColourMaterial = MrtEmitterMaterial;

/** Give a colour pass both of its fragment graphs and the swap between
 *  them, over the shared output-struct helper. */
export function finishStarColourMaterial(
  material: NodeMaterial,
  u: SharedUniformNodes,
  v: StarVaryings,
  gates: EmitterGateNodes,
  kernel: () => Node<'float'>,
): StarColourMaterial {
  return finishMrtMaterial(material, () => starMrtOutputs(u, v, kernel(), gates));
}
