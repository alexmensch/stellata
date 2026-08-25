// TSL uniform-node twins of the solar-system material seam's uniform
// blocks (../../solar-system/materials/glsl-materials.ts) — transcribed
// key-for-key, pinned by a key-parity test.

import { Color, Vector2, Vector3, Vector4, type Texture } from 'three';
import { texture, uniform, uniformArray } from 'three/tsl';
import { MAX_SHADOW_CASTERS } from '../../solar-system/planets/body-shadow-pure';
import { MIE_G_DEFAULT, SUN_COLOUR } from '../../solar-system/atmosphere/atmosphere-scattering-pure';
import {
  PLANET_MESH_TEXTURE_SLOTS, PLANET_RINGS_TEXTURE_SLOTS, textureSlotRecord,
} from '../../solar-system/materials/texture-slots';

/** Each clone is a GPU texture this material owns; `owned` collects them
 *  for its dispose. Why a clone per slot rather than one shared
 *  placeholder: `../../solar-system/materials/texture-slots.ts`. */
function slotPlaceholder(placeholder: Texture, owned: Texture[]): Texture {
  const tex = placeholder.clone();
  tex.needsUpdate = true;
  owned.push(tex);
  return tex;
}

const textureSlotNodes = <S extends readonly string[]>(
  slots: S, placeholder: Texture, owned: Texture[],
) => textureSlotRecord(slots, () => texture(slotPlaceholder(placeholder, owned)));

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

export function planetMeshUniformNodes(placeholder: Texture, owned: Texture[]) {
  return {
    ...textureSlotNodes(PLANET_MESH_TEXTURE_SLOTS, placeholder, owned),
    uHasMap: uniform(0),
    uHasNormalMap: uniform(0),
    uReliefHorizon: uniform(new Vector2()),
    uHasHorizonMap: uniform(0),
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

export function planetRingsUniformNodes(placeholder: Texture, owned: Texture[]) {
  return {
    ...textureSlotNodes(PLANET_RINGS_TEXTURE_SLOTS, placeholder, owned),
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
