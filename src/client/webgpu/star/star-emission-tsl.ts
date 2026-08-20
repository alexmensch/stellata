// Fragment-stage pieces the star colour passes share: the unit-peak
// profile value at the fragment, star.frag.glsl's starEmission() colour
// output (inline operator whenever no HDR target is bound), and the MRT
// output struct + mode swap of ../hdr/README.md § The gate becomes the
// output struct.

import { length, outputStruct, select, vec4 } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';
import { statisticTexelTsl } from '../emission-tsl';
import type { EmitterGateNodes } from '../hdr/emitter-gates';
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

/** The three-attachment output of a star colour draw: colour, the
 *  statistic texel (no coverage claim — stars draw a kernel; alpha 1 so
 *  the glow blend's SrcAlpha factor cannot scale the flux a second
 *  time), and the diffuse slot's identity element in place of the WebGL
 *  gate's NONE. The park/frame-cost mask multiplies the flux to the same
 *  identity (../hdr/README.md § The gate becomes the output struct). */
export function starMrtStruct(
  u: SharedUniformNodes,
  v: StarVaryings,
  glow: Node<'float'>,
  gates: EmitterGateNodes,
) {
  return outputStruct(
    starEmissionColour(u, v, glow),
    statisticTexelTsl(
      v.vFluxPeakL.mul(glow).mul(gates.statisticWrites), 0.0, 1.0),
    vec4(0.0),
  );
}

export interface StarColourMaterial {
  material: NodeMaterial;
  /** Swap between the single-output fragment (rendering to the canvas —
   *  chart mode, or no HDR target) and the three-member MRT struct (HDR
   *  target bound). The member count must match the bound target's
   *  attachment count or pipeline creation fails, so the HDR pipeline
   *  drives this in lockstep with its own target mode. */
  setMrtOutputs(on: boolean): void;
}

export function makeStarColourMaterial(
  material: NodeMaterial,
  single: Node,
  struct: Node,
): StarColourMaterial {
  let mrtOn = false;
  material.fragmentNode = single;
  return {
    material,
    setMrtOutputs(on: boolean) {
      if (on === mrtOn) return;
      mrtOn = on;
      material.fragmentNode = on ? struct : single;
      material.needsUpdate = true;
    },
  };
}
