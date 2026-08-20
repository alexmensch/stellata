// Fragment-stage pieces the star colour passes share: the unit-peak
// profile value at the fragment, and star.frag.glsl's starEmission()
// colour output (inline operator whenever no HDR target is bound).

import { length, select, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import { tonemapUnditheredTsl } from '../tonemap-tsl';
import {
  perceptualDiscExponentTsl,
  perceptualDiscProfileTsl,
} from './perceptual-disc-tsl';
import type { StarVaryings } from './star-vertex-tsl';

/** The super-Gaussian kernel at this fragment: radius from vUv, exponent
 *  morphed on the per-instance softness and phys-ratio varyings. */
export function starGlowNode(u: SharedUniformNodes, v: StarVaryings) {
  const n = perceptualDiscExponentTsl(
    v.vSoftness, v.vPhysRatio, u.uDistNMin, u.uDistNMax, u.uLumBiasMin, u.uLumBiasMax);
  return perceptualDiscProfileTsl(length(v.vUv), n, u.uVisibleThreshold, u.uVisibleK);
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
