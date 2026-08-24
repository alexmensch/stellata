// TSL uniform-node twins of the solar-system material seam's uniform
// blocks (../../solar-system/materials/glsl-materials.ts) — transcribed
// key-for-key, pinned by a key-parity test.

import { Color, Vector2, Vector3, Vector4, type Texture, type IUniform } from 'three';
import { texture, uniform, uniformArray } from 'three/tsl';
import { MAX_SHADOW_CASTERS } from '../../solar-system/planets/body-shadow-pure';
import { MIE_G_DEFAULT, SUN_COLOUR } from '../../solar-system/atmosphere/atmosphere-scattering-pure';

/** A uniform-array node behind an `IUniform` face: the layer mutates the
 *  Vector4s in place, and the node re-packs the buffer every render. */
function arraySlot(node: ReturnType<typeof uniformArray>): IUniform {
  return { get value() { return node.array; } };
}

/** Every texture slot gets its OWN stand-in. three keys a texture
 *  uniform's binding on its VALUE's uuid at shader build
 *  (`TextureNode.getUniformHash`), so two slots holding one shared
 *  placeholder at first render merge into a single binding — and the
 *  merged-away slot's later `.value` writes never reach the GPU (the
 *  load-order-dependent wrong-map/placeholder-stuck planet bug). The
 *  layer's per-frame release writes must keep the same per-slot
 *  identity: it snapshots these initial values rather than re-seeding
 *  slots onto one shared texture. */
function slotPlaceholder(placeholder: Texture): Texture {
  const tex = placeholder.clone();
  tex.needsUpdate = true;
  return tex;
}

export function sharedAtmoUniformNodes() {
  return {
    uCenterView: uniform(new Vector3()),
    uRadiusPc: uniform(1),
    uAtmoRadius: uniform(1.02),
    uPoleView: uniform(new Vector3(0, 1, 0)),
    uPolarRadiusR: uniform(1),
    uScaleHeightR: uniform(0.01),
    uScaleHeightM: uniform(0.01),
    uBetaRayleigh: uniform(new Vector3()),
    uBetaMie: uniform(0),
    uBetaAbsorb: uniform(new Vector3()),
    uMieG: uniform(MIE_G_DEFAULT),
    uSunColour: uniform(new Vector3(SUN_COLOUR[0], SUN_COLOUR[1], SUN_COLOUR[2])),
  };
}

export type SharedAtmoNodes = ReturnType<typeof sharedAtmoUniformNodes>;

export function planetMeshUniformNodes(placeholder: Texture) {
  return {
    uMap: texture(slotPlaceholder(placeholder)),
    uHasMap: uniform(0),
    uNormalMap: texture(slotPlaceholder(placeholder)),
    uHasNormalMap: uniform(0),
    uReliefHorizon: uniform(new Vector2()),
    uHorizonA: texture(slotPlaceholder(placeholder)),
    uHorizonB: texture(slotPlaceholder(placeholder)),
    uHasHorizonMap: uniform(0),
    uSkyView: texture(slotPlaceholder(placeholder)),
    uHasSkyView: uniform(0),
    uTerrainAlbedo: uniform(0),
    uColour: uniform(new Color(1, 1, 1)),
    uSunDirView: uniform(new Vector3(0, 0, 1)),
    uFade: uniform(0),
    uPhaseScale: uniform(1),
    uSurfaceLuminance: uniform(0),
    uUmbralGlow: uniform(new Vector3()),
    uAirlightLuminance: uniform(0),
    uTermSoftness: uniform(0),
    uCasters: uniformArray<'vec4'>(
      Array.from({ length: MAX_SHADOW_CASTERS }, () => new Vector4()), 'vec4'),
    uCasterCount: uniform(0),
    uSunAngRad: uniform(0),
    uHasAtmosphere: uniform(0),
    ...sharedAtmoUniformNodes(),
  };
}

export type PlanetMeshNodes = ReturnType<typeof planetMeshUniformNodes>;

export function planetRingsUniformNodes(placeholder: Texture) {
  return {
    uRingMap: texture(slotPlaceholder(placeholder)),
    uInnerRatio: uniform(0),
    uOuterPc: uniform(1),
    uEqRadiusPc: uniform(1),
    uPolarRadiusPc: uniform(1),
    uSunDirLocal: uniform(new Vector3(0, 0, 1)),
    uCamPosLocal: uniform(new Vector3(0, 0, 1)),
    uRingPhaseScale: uniform(1),
    uFade: uniform(0),
    uAirlightLuminance: uniform(0),
  };
}

export type PlanetRingsNodes = ReturnType<typeof planetRingsUniformNodes>;

export function planetAtmosphereUniformNodes() {
  return {
    ...sharedAtmoUniformNodes(),
    uSunDirView: uniform(new Vector3(0, 0, 1)),
    uAirlightLuminance: uniform(0),
    uFade: uniform(0),
  };
}

export type PlanetAtmosphereNodes = ReturnType<typeof planetAtmosphereUniformNodes>;

export function probeMarkerUniformNodes() {
  return {
    uSizePx: uniform(1),
    uColour: uniform(new Color(1, 1, 1)),
  };
}

export type ProbeMarkerNodes = ReturnType<typeof probeMarkerUniformNodes>;

/** The node record behind the `IUniform` face the layers write. Every node
 *  but the caster array already carries `.value`; that one needs the
 *  adapter above. */
export function uniformSlotsOf(nodes: Record<string, unknown>): Record<string, IUniform> {
  const slots: Record<string, IUniform> = {};
  for (const [key, node] of Object.entries(nodes)) {
    slots[key] = (node as { isArrayBufferNode?: boolean }).isArrayBufferNode === true
      ? arraySlot(node as ReturnType<typeof uniformArray>)
      : (node as IUniform);
  }
  return slots;
}
