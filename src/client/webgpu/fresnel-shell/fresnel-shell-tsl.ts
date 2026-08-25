// fresnel-shell.vert.glsl / .frag.glsl on the TSL path: the translucent
// boundary shell whose alpha peaks at the silhouette.

import { FrontSide, NormalBlending } from 'three';
import { normalView, positionView, vec4 } from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import type { FresnelShellMaterialOptions } from '../../fresnel-shell/fresnel-shell';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import { fresnelRimAlphaTsl } from './fresnel-rim-tsl';
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
  // The hide-when-inside contract: outward winding plus front-face-only
  // means the shell culls when the camera sits inside it
  // (`../../fresnel-shell/README.md` § Invariants).
  material.side = FrontSide;

  // No vertexNode: NodeMaterial's own model-view-projection is exactly what
  // fresnel-shell.vert.glsl does, and both its varyings are built-ins
  // (`../solar-system/README.md` § Vertex stages).
  return finishMrtMaterial(material, () => {
    const alpha = fresnelRimAlphaTsl(
      normalView.normalize(),
      positionView.negate().normalize(),
      s.uAlphaLimb, s.uFaceOnFloor, s.uFresnelPower,
    );
    // Chrome: an authored colour inverse-mapped through the operator, with
    // no claim on the light already in the target. Both extra attachments
    // take the blend's identity element (`../hdr/README.md` § The gate
    // becomes the output struct).
    return {
      colour: vec4(s.uColour, alpha),
      statistic: vec4(0.0),
      diffuse: vec4(0.0),
    };
  });
}
