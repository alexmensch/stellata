// The contract the two band components are built through.
// See README.md#the-material-seam.

import * as THREE from 'three';
import type { EmitterMaterial } from '../scene/emitter-material';
import { ICRS_TO_GAL_M3, GALACTIC_CENTRE_PC, R0_PC } from '../galactic/galactic-coords';
import { SB_ZERO_POINT } from '../hdr/emission/emission-pure';
import {
  ANALYTICAL_DUST_NORM_PER_PC,
  ANALYTICAL_DUST_SCALE_HEIGHT_PC,
  ANALYTICAL_DUST_SCALE_LENGTH_PC,
  DEFAULT_DUST_AV_PER_DENSITY_PC,
  DEFAULT_EXTINCTION_STRENGTH,
  REDDENING_RGB,
} from './milkyway-column-pure';
import { writeResolvedHoleTexture } from './calibration/resolved-hole-texture';

/**
 * The slots the disc and the bulge hold **by reference to each other**, so
 * one write reaches both draws — the dust model, the galactic frame, the
 * surface-brightness anchor and the chart isobar.
 *
 * These are the layer's own objects, NOT the frame-wide shared map's, even
 * where a name collides: `Stellata.setExtinctionStrength` writes the frame
 * map and this one separately. The factory therefore builds them as its
 * own nodes rather than taking the shared uniform-node mirror's, whose
 * per-frame `sync()` copies from the frame map and would overwrite a write
 * made here.
 */
export interface BandSharedSlots {
  uDustAvPerDensityPc: THREE.IUniform;
  uDustEnabled: THREE.IUniform;
  uExtinctionStrength: THREE.IUniform;
  uAnalyticalDustScaleLengthPc: THREE.IUniform;
  uAnalyticalDustScaleHeightPc: THREE.IUniform;
  uAnalyticalDustNormPerPc: THREE.IUniform;
  uReddeningRGB: THREE.IUniform;
  uWorldOffset: THREE.IUniform;
  uIcrsToGal: THREE.IUniform;
  uGalCenter: THREE.IUniform;
  uR0Pc: THREE.IUniform;
  /** The `Data3DTexture`, written in place through
   *  `writeResolvedHoleTexture` and never reassigned — both components'
   *  graphs hold it from build time. */
  uUnresolvedLight: THREE.IUniform;
  uGlowMagOffset: THREE.IUniform;
  uChartIsobar: THREE.IUniform;
  uChartInkColor: THREE.IUniform;
}

/**
 * A TSL `uniform()` node is constructed on a literal rather than on the
 * layer's constant, so without this the band marches a placeholder dust
 * model. The factory calls it, which is what makes `BandMaterials.shared`
 * live the moment it is handed out. Every key is written here; `band-materials.test.ts` fails if one is not.
 */
export function seedBandSharedSlots(s: BandSharedSlots): void {
  s.uDustAvPerDensityPc.value = DEFAULT_DUST_AV_PER_DENSITY_PC;
  s.uDustEnabled.value = 0;
  s.uExtinctionStrength.value = DEFAULT_EXTINCTION_STRENGTH;
  s.uAnalyticalDustScaleLengthPc.value = ANALYTICAL_DUST_SCALE_LENGTH_PC;
  s.uAnalyticalDustScaleHeightPc.value = ANALYTICAL_DUST_SCALE_HEIGHT_PC;
  s.uAnalyticalDustNormPerPc.value = ANALYTICAL_DUST_NORM_PER_PC;
  (s.uReddeningRGB.value as THREE.Vector3).set(...REDDENING_RGB);
  (s.uWorldOffset.value as THREE.Vector3).set(0, 0, 0);
  (s.uIcrsToGal.value as THREE.Matrix3).copy(ICRS_TO_GAL_M3);
  (s.uGalCenter.value as THREE.Vector3).copy(GALACTIC_CENTRE_PC);
  s.uR0Pc.value = R0_PC;
  writeResolvedHoleTexture(s.uUnresolvedLight.value as THREE.Data3DTexture);
  s.uGlowMagOffset.value = SB_ZERO_POINT;
  s.uChartIsobar.value = 0;
  (s.uChartInkColor.value as THREE.Color).setHex(0x000000);
}

/** What differs between the disc draw and the bulge draw. */
export interface BandComponentSpec {
  /** Selects the oblate-spheroid profile over the thin+thick disc. */
  isBulge: boolean;
  meshScalePc: THREE.Vector3;
  density0: number;
  /** The population tint, already luma-normalised (hue only). */
  tint: THREE.Color;
  discScaleLengthPc: number;
  discScaleHeightPc: number;
  discThickScaleHeightPc: number;
  discThickFraction: number;
  bulgeScaleRadiusPc: number;
  bulgeAxisRatio: number;
}

export interface BandMaterials {
  /** The slots both components share; the layer writes through these. */
  readonly shared: BandSharedSlots;
  component(spec: BandComponentSpec): EmitterMaterial;
  /** Releases what the factory allocated outside any one material — the
   *  resolution-hole texture. Each component disposes its own. */
  dispose(): void;
}
