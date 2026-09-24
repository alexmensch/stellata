// BandMaterials test double: records what the layer asked for.
// See README.md#the-material-seam.

import * as THREE from 'three';
import { surfaceRecorder, type FakeEmitterMaterial } from '../scene/emitter-material-mock';
import {
  seedBandSharedSlots,
  type BandComponentSpec,
  type BandMaterials,
  type BandSharedSlots,
} from './band-materials';
import { makeResolvedHoleTexture } from './calibration/resolved-hole-texture';

/** A shared-slot record whose every slot holds `fill` in its own value
 *  kind. Typed as `BandSharedSlots`, so a slot added to the group fails
 *  to compile here before it can fail an assertion. `fill` must be exactly
 *  representable in half-float — one slot is a texture, and a value that
 *  quantises on the way in reads back as something else. */
export function bandSharedSlots(fill: number): BandSharedSlots {
  const n = () => ({ value: fill });
  const v = () => ({ value: new THREE.Vector3(fill, fill, fill) });
  return {
    uDustAvPerDensityPc: n(),
    uDustEnabled: n(),
    uExtinctionStrength: n(),
    uAnalyticalDustScaleLengthPc: n(),
    uAnalyticalDustScaleHeightPc: n(),
    uAnalyticalDustNormPerPc: n(),
    uReddeningRGB: v(),
    uWorldOffset: v(),
    uIcrsToGal: { value: new THREE.Matrix3().set(
      fill, fill, fill, fill, fill, fill, fill, fill, fill) },
    uGalCenter: v(),
    uR0Pc: n(),
    uUnresolvedLight: { value: filledHoleTexture(fill) },
    uGlowMagOffset: n(),
    uChartIsobar: n(),
    uChartInkColor: { value: new THREE.Color().setRGB(fill, fill, fill) },
  };
}

function filledHoleTexture(fill: number): THREE.Data3DTexture {
  const tex = makeResolvedHoleTexture();
  (tex.image.data as Uint16Array).fill(THREE.DataUtils.toHalfFloat(fill));
  return tex;
}

export interface FakeBandMaterials extends BandMaterials {
  /** One per `component()` call, in build order: disc, then bulge. */
  readonly specs: BandComponentSpec[];
  readonly surfaces: FakeEmitterMaterial[];
}

export function fakeBandMaterials(): FakeBandMaterials {
  const specs: BandComponentSpec[] = [];
  const recorder = surfaceRecorder((surface, spec: BandComponentSpec) => {
    specs.push(spec);
    surface.uniforms.uDensity0.value = spec.density0;
    surface.uniforms.uColor.value = spec.tint.clone();
  });
  const shared = bandSharedSlots(0);
  seedBandSharedSlots(shared);
  return {
    shared,
    specs,
    surfaces: recorder.surfaces,
    component: (spec) => recorder.mint(spec),
    dispose() {
      (shared.uUnresolvedLight.value as THREE.Data3DTexture).dispose();
    },
  };
}
