// dust-particle.vert.glsl / .frag.glsl on the TSL path: the additive
// density-sized billboard.

import { AdditiveBlending } from 'three';
import {
  Discard, Fn, If, cameraProjectionMatrix, clamp, float, length, log, max, mix,
  modelViewMatrix, varying, vec3, vec4,
} from 'three/tsl';
import { NodeMaterial } from 'three/webgpu';
import {
  DUST_TINT, PARTICLE_DIM_FLOOR, PARTICLE_MAX_PX, PARTICLE_MIN_PX,
} from '../../dust/dust-particle-pure';
import { finishMrtMaterial, type MrtEmitterMaterial } from '../hdr/mrt-material';
import type { DustParticleNodes } from './dust-uniform-nodes';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { attrFloat, attrVec2, attrVec3 } from '../tsl/tsl-shim';

const LOG10 = Math.log(10);

export function buildDustParticleMaterial(
  u: SharedUniformNodes,
  d: DustParticleNodes,
): MrtEmitterMaterial {
  const material = new NodeMaterial();
  material.name = 'dust-particle-tsl';
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.blending = AdditiveBlending;

  const vUv = varying(attrVec2('aCorner'), 'vDustUv');
  const vBrightness = varying(float(0), 'vDustBrightness');

  material.vertexNode = Fn(() => {
    // Density → [0, 1] over the same log window the dust texture decode
    // uses, so the scale matches the visible range of real Edenhofer
    // values rather than synthetic peaks.
    const logD = log(max(attrFloat('iDensity'), u.uDustDensityMin)).div(LOG10);
    const logMin = log(u.uDustDensityMin).div(LOG10);
    const logSpan = u.uDustLogRatio.div(LOG10);
    const normD = clamp(logD.sub(logMin).div(max(logSpan, 0.001)), 0.0, 1.0).toVar();

    vBrightness.assign(
      mix(float(PARTICLE_DIM_FLOOR), 1.0, normD).mul(d.uParticleStrength));
    const pxSize = mix(float(PARTICLE_MIN_PX), float(PARTICLE_MAX_PX), normD);

    // The GLSL early return's off-screen sentinel; TSL has no
    // value-carrying return, so the draw path assigns over it.
    const clipOut = vec4(2.0, 2.0, 2.0, 1.0).toVar();
    If(u.uDustEnabled.greaterThanEqual(0.5).and(d.uParticleStrength.greaterThan(0.0)), () => {
      // Local-frame position so the floating-origin shift cancels and the
      // GPU never sees kpc-scale translations in the modelview.
      const localPos = attrVec3('iPosition').sub(u.uWorldOffset);
      const centreClip = cameraProjectionMatrix
        .mul(modelViewMatrix.mul(vec4(localPos, 1.0))).toVar();
      // uPixelRatio cancels between the pixel offset and the viewport it
      // divides by, exactly as it does for the probe glyph.
      const ndcOffset = attrVec2('aCorner').mul(pxSize).div(u.uViewport).mul(2.0);
      clipOut.assign(centreClip.add(vec4(ndcOffset.mul(centreClip.w), 0.0, 0.0)));
    });
    return clipOut;
  })();

  return finishMrtMaterial(material, () => {
    const r = length(vUv);
    Discard(r.greaterThan(0.5));
    // Quadratic radial falloff so particle edges fade smoothly into the
    // background — sharper than linear, softer than exp.
    const falloff = float(1.0).sub(r.mul(2.0)).toVar();
    return {
      colour: vec4(vec3(...DUST_TINT).mul(falloff.mul(falloff)).mul(vBrightness), 1.0),
      statistic: vec4(0.0),
      diffuse: vec4(0.0),
    };
  });
}
