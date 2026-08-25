// probe.vert.glsl / probe.frag.glsl on the TSL path: the fixed-pixel
// diamond glyph, one material for both passes (README.md § The probe glyph
// needs no mirror variant).

import {
  Discard, Fn, If, abs, cameraProjectionMatrix, float, max, modelViewMatrix,
  smoothstep, varying, vec4,
} from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { attrFloat, attrVec2, attrVec3 } from '../tsl/tsl-shim';
import type { ProbeMarkerNodes } from './uniform-nodes';

export function buildProbeMarkerMaterial(
  u: SharedUniformNodes,
  p: ProbeMarkerNodes,
): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'probe-marker-tsl';
  material.transparent = true;
  material.depthTest = true;
  material.depthWrite = false;

  const vUv = varying(attrVec2('aCorner'), 'vProbeUv');
  const vAlpha = varying(attrFloat('iAlpha'), 'vProbeAlpha');

  material.vertexNode = Fn(() => {
    const probeView = modelViewMatrix.mul(vec4(attrVec3('iLocalPos'), 1.0)).toVar();
    // The GLSL early return's off-screen sentinel; TSL has no
    // value-carrying return, so the draw path assigns over it.
    const clipOut = vec4(2.0, 2.0, 2.0, 1.0).toVar();
    If(attrFloat('iAlpha').greaterThan(0.0).and(probeView.z.lessThan(0.0)), () => {
      // Fixed pixel size at any range: a metre-scale probe has no
      // meaningful angular diameter or reflected magnitude, so the marker
      // is chrome — project the centre and expand the corners in screen
      // space. uPixelRatio cancels out; uViewport and uSizePx are both CSS
      // pixels.
      const centreClip = cameraProjectionMatrix.mul(vec4(probeView.xyz, 1.0)).toVar();
      const ndcOffset = attrVec2('aCorner').mul(p.uSizePx).div(u.uViewport).mul(2.0);
      clipOut.assign(centreClip.add(vec4(ndcOffset.mul(centreClip.w), 0.0, 0.0)));
    });
    return clipOut;
  })();

  return finishMrtMaterial(material, () => {
    // Diamond glyph: a rotated square reads as a spacecraft marker rather
    // than one more star point, and stays legible at the few-pixel size the
    // vertex stage pins. Edge antialiased over one pixel of the quad.
    const d = abs(vUv.x).add(abs(vUv.y));
    const aa = float(1.0).div(max(p.uSizePx, 1.0));
    const mask = float(1.0).sub(smoothstep(float(0.5).sub(aa), 0.5, d)).toVar();
    Discard(mask.lessThanEqual(0.0).or(vAlpha.lessThanEqual(0.0)));
    // Chrome: an authored colour inverse-mapped through the operator, with
    // no claim on the light already in the target and no occlusion of the
    // diffuse field (../../hdr/attachments/README.md § Known residuals).
    // Both extra attachments take the blend's identity element — alpha 0
    // under this alpha-composited blend leaves the destination exactly as
    // the WebGL gate's NONE did.
    return {
      colour: vec4(p.uColour, vAlpha.mul(mask)),
      statistic: vec4(0.0),
      diffuse: vec4(0.0),
    };
  });
}
