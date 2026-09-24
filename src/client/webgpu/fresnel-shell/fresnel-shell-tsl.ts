// The boundary shell's graph: the translucent
// boundary shell whose alpha peaks at the silhouette.

import { FrontSide, NormalBlending } from 'three';
import { length, normalView, positionView, vec4 } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import type { FresnelShellMaterialOptions } from '../../fresnel-shell/fresnel-shell';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import { fresnelRimAlphaTsl, shellDistanceAttenuationTsl } from './fresnel-rim-tsl';
import type { FresnelShellNodes } from './shell-uniform-nodes';

export function buildFresnelShellMaterial(
  s: FresnelShellNodes,
  opts: FresnelShellMaterialOptions,
): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'fresnel-shell-tsl';
  material.transparent = true;
  material.depthWrite = false;
  material.blending = opts.blending ?? NormalBlending;
  // Not a redundant default — this IS the hide-when-inside contract
  // (`../../fresnel-shell/README.md#invariants`).
  material.side = FrontSide;

  return finishMrtMaterial(material, () => {
    const dView = length(positionView).toVar();
    const alpha = fresnelRimAlphaTsl(
      normalView.normalize(),
      positionView.negate().div(dView),
      s.uAlphaLimb, s.uFaceOnFloor, s.uFresnelPower,
    ).mul(shellDistanceAttenuationTsl(
      dView, s.uNearFadePc, s.uDepthDimRefPc, s.uDepthPower,
    ));
    // Chrome: an authored colour inverse-mapped through the operator, with
    // no claim on the light already in the target. Both extra attachments
    // take the blend's identity element (`../hdr/README.md#the-gate-becomes-the-output-struct`).
    return {
      colour: vec4(s.uColour, alpha),
      statistic: vec4(0.0),
      diffuse: vec4(0.0),
    };
  });
}
