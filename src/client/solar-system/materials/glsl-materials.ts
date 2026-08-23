// The WebGL2 implementation of the solar-system material seam: the four
// RawGLSL surfaces, their uniform blocks, and the blend/depth state each
// one's contract rests on. See README.md.

import * as THREE from 'three';
import { pickHdrEmitterUniforms, type HdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { MAX_SHADOW_CASTERS } from '../planets/body-shadow-pure';
import {
  ATMO_N_LIGHT, ATMO_N_VIEW, MIE_G_DEFAULT, SUN_COLOUR,
} from '../atmosphere/atmosphere-scattering-pure';
import meshVert from '../planets/planet-mesh.vert.glsl?raw';
import meshFrag from '../planets/planet-mesh.frag.glsl?raw';
import ringsVert from '../planets/rings/planet-rings.vert.glsl?raw';
import ringsFrag from '../planets/rings/planet-rings.frag.glsl?raw';
import atmoVert from '../atmosphere/planet-atmosphere.vert.glsl?raw';
import atmoFrag from '../atmosphere/planet-atmosphere.frag.glsl?raw';
import atmoScatterChunk from '../atmosphere/atmosphere-scatter.glsl?raw';
import atmoUniformsChunk from '../atmosphere/atmosphere-uniforms.glsl?raw';
import probeVert from '../probes/probe.vert.glsl?raw';
import probeFrag from '../probes/probe.frag.glsl?raw';
import type { EmitterMaterial, SolarSystemMaterials } from './emitter-material';

// The shared atmosphere GLSL — the uniform contract and the
// single-scattering integrator — spliced into both the mesh disc and the
// shell fragment sources; the sample-count #defines ride each material so
// the loop bounds track atmosphere-scattering-pure.ts.
const ATMO_CHUNKS: Record<string, string> = {
  '#include <stellata_atmosphere_uniforms>': atmoUniformsChunk,
  '#include <stellata_atmosphere_scatter>': atmoScatterChunk,
};
const withAtmoChunks = (frag: string): string =>
  Object.entries(ATMO_CHUNKS).reduce((src, [inc, chunk]) => src.replace(inc, chunk), frag);
const MESH_FRAG = withAtmoChunks(meshFrag);
const ATMO_FRAG = withAtmoChunks(atmoFrag);
const ATMO_DEFINES = { ATMO_N_VIEW, ATMO_N_LIGHT } as const;

/** The atmosphere-scatter uniform block both the mesh disc airlight and
 *  the limb shell read; `planet-mesh-layer.ts` fills it per frame. The TSL
 *  twin transcribes the same keys, and a key-parity test pins the pair
 *  (`glsl-materials.test.ts`). */
export function sharedAtmoUniforms(): Record<string, THREE.IUniform> {
  return {
    uCenterView: { value: new THREE.Vector3() },
    uRadiusPc: { value: 1 },
    uAtmoRadius: { value: 1.02 },
    uPoleView: { value: new THREE.Vector3(0, 1, 0) },
    uPolarRadiusR: { value: 1 },
    uScaleHeightR: { value: 0.01 },
    uScaleHeightM: { value: 0.01 },
    uBetaRayleigh: { value: new THREE.Vector3() },
    uBetaMie: { value: 0 },
    uBetaAbsorb: { value: new THREE.Vector3() },
    uMieG: { value: MIE_G_DEFAULT },
    uSunColour: { value: new THREE.Vector3(SUN_COLOUR[0], SUN_COLOUR[1], SUN_COLOUR[2]) },
  };
}

/** Per-body slots the mesh material owns outright. Every one is a neutral
 *  default: the layer writes each body's own value straight after
 *  construction, so neither backend's factory needs a `Planet`. */
export function planetMeshUniforms(placeholder: THREE.Texture): Record<string, THREE.IUniform> {
  return {
    uMap: { value: placeholder },
    uHasMap: { value: 0 },
    uNormalMap: { value: placeholder },
    uHasNormalMap: { value: 0 },
    uReliefHorizon: { value: new THREE.Vector2() },
    uHorizonA: { value: placeholder },
    uHorizonB: { value: placeholder },
    uHasHorizonMap: { value: 0 },
    uSkyView: { value: placeholder },
    uHasSkyView: { value: 0 },
    uTerrainAlbedo: { value: 0 },
    uColour: { value: new THREE.Color(1, 1, 1) },
    uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
    uFade: { value: 0 },
    uPhaseScale: { value: 1 },
    uSurfaceLuminance: { value: 0 },
    uUmbralGlow: { value: new THREE.Vector3() },
    uAirlightLuminance: { value: 0 },
    uTermSoftness: { value: 0 },
    uCasters: {
      value: Array.from({ length: MAX_SHADOW_CASTERS }, () => new THREE.Vector4()),
    },
    uCasterCount: { value: 0 },
    uSunAngRad: { value: 0 },
    uHasAtmosphere: { value: 0 },
    ...sharedAtmoUniforms(),
  };
}

export function planetRingsUniforms(
  placeholder: THREE.Texture,
): Record<string, THREE.IUniform> {
  return {
    uRingMap: { value: placeholder },
    uInnerRatio: { value: 0 },
    uOuterPc: { value: 1 },
    uEqRadiusPc: { value: 1 },
    uPolarRadiusPc: { value: 1 },
    uSunDirLocal: { value: new THREE.Vector3(0, 0, 1) },
    uCamPosLocal: { value: new THREE.Vector3(0, 0, 1) },
    uRingPhaseScale: { value: 1 },
    uFade: { value: 0 },
    uAirlightLuminance: { value: 0 },
  };
}

export function planetAtmosphereUniforms(): Record<string, THREE.IUniform> {
  return {
    ...sharedAtmoUniforms(),
    uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
    uAirlightLuminance: { value: 0 },
    uFade: { value: 0 },
  };
}

/** The probe glyph's own slots. `uViewport` / `uPixelRatio` are the
 *  frame-shared pair and arrive by reference at the call site. */
export function probeMarkerUniforms(): Record<string, THREE.IUniform> {
  return {
    uSizePx: { value: 1 },
    uColour: { value: new THREE.Color(1, 1, 1) },
  };
}

export interface GlslMaterialConfig {
  hdr: HdrEmitterUniforms;
  /** 1×1 white stand-in — sampling an unbound texture is undefined in
   *  WebGL, so every texture slot starts here. */
  placeholder: THREE.Texture;
}

function wrap(material: THREE.ShaderMaterial): EmitterMaterial {
  return {
    material,
    uniforms: material.uniforms,
    dispose: () => material.dispose(),
  };
}

/** The glyph alone — it reads neither the HDR seam nor a texture, so the
 *  probe field can build it without the planet surfaces' config. */
export function makeGlslProbeMaterial(): Pick<SolarSystemMaterials, 'probeMarker'> {
  return {
    probeMarker: (
      viewport: { uViewport: THREE.IUniform; uPixelRatio: THREE.IUniform },
      localPass: boolean,
    ) => wrap(new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: probeVert,
      fragmentShader: probeFrag,
      ...(localPass ? { defines: { LOCAL_DEPTH_PASS: '' } } : {}),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      uniforms: {
        uViewport: viewport.uViewport,
        uPixelRatio: viewport.uPixelRatio,
        ...probeMarkerUniforms(),
      },
    })),
  };
}

export function makeGlslSolarSystemMaterials(
  cfg: GlslMaterialConfig,
): SolarSystemMaterials {
  return {
    ...makeGlslProbeMaterial(),
    planetMesh: () => wrap(new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: meshVert,
      fragmentShader: MESH_FRAG,
      uniforms: { ...pickHdrEmitterUniforms(cfg.hdr), ...planetMeshUniforms(cfg.placeholder) },
      defines: { ...ATMO_DEFINES },
      transparent: true,
      depthWrite: true,
      depthTest: true,
    })),

    planetRings: () => wrap(new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: ringsVert,
      fragmentShader: ringsFrag,
      uniforms: { ...pickHdrEmitterUniforms(cfg.hdr), ...planetRingsUniforms(cfg.placeholder) },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    })),

    planetAtmosphere: () => wrap(new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: atmoVert,
      fragmentShader: ATMO_FRAG,
      uniforms: { ...pickHdrEmitterUniforms(cfg.hdr), ...planetAtmosphereUniforms() },
      defines: { ...ATMO_DEFINES },
      transparent: true,
      // Premultiplied over (not additive): the shell adds airlight AND
      // occludes the background by its opacity (frag alpha = 1 − view-path
      // transmittance), so a dense limb chord that scatters no light toward
      // the eye still extincts the stars behind it. Additive left the
      // shadowed base transparent and leaked stars through the ring gap.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false,
      depthTest: true,
    })),

  };
}
