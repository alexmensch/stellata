// SolarSystemMaterials / ProbeMaterials test doubles.
// See README.md § The layer writes `uniforms`, never `material.uniforms`.

import * as THREE from 'three';
import { fakeEmitterMaterial } from '../../scene/emitter-material-mock';
import { MAX_SHADOW_CASTERS } from '../planets/body-shadow-pure';
import type { EmitterMaterial } from '../../scene/emitter-material';
import type { ProbeMaterials, SolarSystemMaterials } from './solar-system-materials';

/** The slots the layers write THROUGH rather than over — a `.copy()` onto
 *  `undefined` throws, so a double has to hand back the object. Which
 *  surface carries which is the factory's business; seeding them all here
 *  keeps the double out of that roster. */
function seedInPlaceSlots(surface: EmitterMaterial): EmitterMaterial {
  for (const key of [
    'uBetaAbsorb', 'uBetaRayleigh', 'uCamPosLocal', 'uCenterView', 'uPoleView',
    'uSunColour', 'uSunDirLocal', 'uSunDirView', 'uUmbralGlow',
  ]) {
    surface.uniforms[key].value = new THREE.Vector3();
  }
  surface.uniforms.uColour.value = new THREE.Color();
  surface.uniforms.uCasters.value = Array.from(
    { length: MAX_SHADOW_CASTERS }, () => new THREE.Vector4());
  return surface;
}

export function fakeProbeMaterials(): ProbeMaterials {
  return {
    probeMarker() {
      const surface = fakeEmitterMaterial();
      // The layer writes the glyph colour through the chrome inverse, which
      // mutates the slot's Color in place.
      surface.uniforms.uColour.value = new THREE.Color();
      return surface;
    },
  };
}

export function fakeSolarSystemMaterials(): SolarSystemMaterials {
  const surface = () => seedInPlaceSlots(fakeEmitterMaterial());
  return {
    planetMesh: surface,
    planetRings: surface,
    planetAtmosphere: surface,
    planetDepthStamp: () => fakeEmitterMaterial(),
  };
}
