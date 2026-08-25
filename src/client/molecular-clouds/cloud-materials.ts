// The renderer-neutral contract the cloud surfaces are built through, and
// the WebGL2 implementation. See README.md § The material seam.

import * as THREE from 'three';
import type { EmitterMaterial } from '../solar-system/materials/emitter-material';
import { setRawChromeColour } from '../hdr/chrome/chrome-colour';
import {
  DEFAULT_FACE_ON_FLOOR, DEFAULT_FRESNEL_POWER, SHELL_RIM_ALPHA_LIMB, SHELL_RIM_BLUE,
} from '../fresnel-shell/fresnel-shell';
import absorptionVert from './cloud-absorption.vert.glsl?raw';
import absorptionFrag from './cloud-absorption.frag.glsl?raw';
import rimVert from '../fresnel-shell/fresnel-shell.vert.glsl?raw';
import rimFrag from './cloud-rim.frag.glsl?raw';

/** The frame-shared pair the absorption march reads, held by reference on
 *  the WebGL path. */
export interface CloudSharedUniforms {
  uFovYRad: { value: number };
  uViewport: { value: THREE.Vector2 };
}

/** The traced tier: the per-cloud Edenhofer density brick and the frame
 *  that maps a cloud-local sample point into it. Its presence is what
 *  selects the brick-marching variant, on both backends. */
export interface CloudFieldSpec {
  brick: THREE.Data3DTexture;
  densityMax: number;
  /** centerAbs − brick aabbMin, pc. */
  centerFromAabb: THREE.Vector3;
  /** cloud-local → world. */
  rotMat: THREE.Matrix3;
  /** 1 / (stepPc · dims). */
  uvwScale: THREE.Vector3;
  /** 0.5 / dims — texel-centre alignment. */
  uvwBias: THREE.Vector3;
}

/**
 * One cloud's absorption material, as both backends need it.
 *
 * The layer builds this — it owns the brick texture's lifetime either way —
 * so the factories stay pure shader plumbing and the per-cloud constants
 * reach a uniform in exactly one place.
 */
export interface CloudAbsorptionSpec {
  axes: THREE.Vector3;
  n0Cal: number;
  rflatPc: number;
  p: number;
  /** The brick's taper edge on the traced tier, the analytic mass-budget
   *  envelope otherwise — the layer has already decided which. */
  uEnv: number;
  /** Renderer frame → cloud-local frame rotation. */
  invQuat: THREE.Matrix3;
  /** The dev-console step ceiling at construction. */
  steps: number;
  field: CloudFieldSpec | null;
}

/** The rim shell's authored starting values; every one of them is also a
 *  live setter on the layer. */
export interface CloudRimSpec {
  inkHex: number;
  inkAlpha: number;
  opacity: number;
}

export interface CloudMaterials {
  /** One per cloud — the tier is compile-time, so they cannot share. */
  absorption(spec: CloudAbsorptionSpec): EmitterMaterial;
  /** One for every cloud. */
  rim(spec: CloudRimSpec): EmitterMaterial;
}

export function makeGlslCloudMaterials(shared: CloudSharedUniforms): CloudMaterials {
  return {
    absorption(spec) {
      const uniforms: Record<string, THREE.IUniform> = {
        uAxes: { value: spec.axes.clone() },
        uN0Cal: { value: spec.n0Cal },
        uRflat: { value: spec.rflatPc },
        uP: { value: spec.p },
        uUEnv: { value: spec.uEnv },
        uInvQuat: { value: spec.invQuat.clone() },
        uSteps: { value: spec.steps },
        uFovYRad: shared.uFovYRad,
        uViewport: shared.uViewport,
      };
      if (spec.field !== null) {
        const f = spec.field;
        uniforms.uBrick = { value: f.brick };
        uniforms.uDensityMax = { value: f.densityMax };
        uniforms.uCenterFromAabb = { value: f.centerFromAabb.clone() };
        uniforms.uRotMat = { value: f.rotMat.clone() };
        uniforms.uUvwScale = { value: f.uvwScale.clone() };
        uniforms.uUvwBias = { value: f.uvwBias.clone() };
      }
      const material = new THREE.ShaderMaterial({
        vertexShader: absorptionVert,
        fragmentShader: absorptionFrag,
        glslVersion: THREE.GLSL3,
        defines: spec.field !== null ? { USE_FIELD: '' } : {},
        transparent: true,
        depthTest: true,
        depthWrite: false,
        // Alpha-only premultiplied-over: rgb = 0, so NormalBlending becomes
        // (ONE, ONE−α) = background × (1 − absorption).
        blending: THREE.NormalBlending,
        premultipliedAlpha: true,
        // BackSide: exactly one fragment per covered pixel from outside AND
        // inside (the raymarch segment is analytic either way); FrontSide
        // would kill the inside-the-cloud absorption.
        side: THREE.BackSide,
        uniforms,
      });
      return { material, uniforms: material.uniforms, dispose: () => material.dispose() };
    },

    rim(spec) {
      const material = new THREE.ShaderMaterial({
        vertexShader: rimVert,
        fragmentShader: rimFrag,
        glslVersion: THREE.GLSL3,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // FrontSide + outward winding = the fresnel-shell hide-when-inside
        // contract: the shell back-face-culls when the camera is inside the
        // cloud (absorption keeps working from inside — it is BackSide).
        side: THREE.FrontSide,
        uniforms: {
          uColour: { value: setRawChromeColour(new THREE.Color(), SHELL_RIM_BLUE) },
          uAlphaLimb: { value: SHELL_RIM_ALPHA_LIMB },
          uFaceOnFloor: { value: DEFAULT_FACE_ON_FLOOR },
          uFresnelPower: { value: DEFAULT_FRESNEL_POWER },
          uOpacity: { value: spec.opacity },
          uChart: { value: 0 },
          uInk: { value: new THREE.Color(spec.inkHex) },
          uInkAlpha: { value: spec.inkAlpha },
        },
      });
      return { material, uniforms: material.uniforms, dispose: () => material.dispose() };
    },
  };
}
