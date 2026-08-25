// The renderer-neutral contract the Local Group emission passes are built
// through, and the WebGL2 implementation. See README.md § The material seam.

import * as THREE from 'three';
import type { EmitterMaterial } from '../../scene/emitter-material';
import type { HdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { EMISSION_STEPS_DISC, EMISSION_STEPS_SERSIC } from './local-group-emission-pure';
import emissionVert from './local-group-emission.vert.glsl?raw';
import emissionFrag from './local-group-emission.frag.glsl?raw';

export interface LgEmissionMaterials {
  /** One per family. `isDisc` picks the disc profile and its step count;
   *  the Sérsic spheroid pass is the other. */
  emission(isDisc: boolean): EmitterMaterial;
}

export interface GlslLgEmissionConfig {
  /** The layer's floating-origin slot, held by reference. */
  uWorldOffset: { value: THREE.Vector3 };
  /** Exposure, both solid angles, and the inline-operator branch. Owned by
   *  HdrPipeline; this layer only reads them. */
  hdr: HdrEmitterUniforms;
}

export function makeGlslLgEmissionMaterials(
  cfg: GlslLgEmissionConfig,
): LgEmissionMaterials {
  return {
    emission(isDisc) {
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: emissionVert,
        fragmentShader: emissionFrag,
        defines: isDisc
          ? { FAMILY_DISC: 1, EMISSION_STEPS: EMISSION_STEPS_DISC }
          : { EMISSION_STEPS: EMISSION_STEPS_SERSIC },
        // Same render contract as the MilkyWay volumetric pass: BackSide
        // gives one fragment per ray with the back face as the natural
        // exit; entry is computed analytically in the fragment shader.
        side: THREE.BackSide,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uWorldOffset: cfg.uWorldOffset,
          ...cfg.hdr,
        },
      });
      return { material, uniforms: material.uniforms, dispose: () => material.dispose() };
    },
  };
}
