// The renderer-neutral contract the two band components are built
// through, and the WebGL2 implementation. See README.md § The material seam.

import * as THREE from 'three';
import type { EmitterMaterial } from '../solar-system/materials/emitter-material';
import type { HdrEmitterUniforms } from '../hdr/hdr-pipeline';
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
import milkywayVert from './milkyway.vert.glsl?raw';
import milkywayFrag from './milkyway.frag.glsl?raw';

/**
 * The slots the disc and the bulge hold **by reference to each other**, so
 * one write reaches both draws — the dust model, the galactic frame, the
 * surface-brightness anchor and the chart isobar.
 *
 * These are the layer's own objects, NOT the frame-wide shared map's, even
 * where a name collides: `Stellata.setExtinctionStrength` writes the frame
 * map and this one separately. The TSL twin therefore mirrors them as its
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
  uGlowMagOffset: THREE.IUniform;
  uChartIsobar: THREE.IUniform;
  uChartInkColor: THREE.IUniform;
}

/**
 * Write every shared slot's authored constant into it.
 *
 * A TSL `uniform()` node is constructed on a literal rather than on the
 * layer's constant, so without this the WebGPU band marches a placeholder
 * dust model. Both factories call it, which is what makes
 * `BandMaterials.shared` live the moment it is handed out — and what keeps
 * a slot added to only one backend's record from rendering the placeholder.
 * Every key is written here; `band-materials.test.ts` fails if one is not.
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
}

export interface GlslBandConfig {
  /** Exposure, both solid angles, and the inline-operator branch. */
  hdr: HdrEmitterUniforms;
  /** The instrument limit the chart isobar would contour against. Plumbed
   *  but unread in practice — the contour has never drawn (README.md
   *  § Chart mode + warp). */
  uLimitMag: THREE.IUniform;
}

export function makeGlslBandMaterials(cfg: GlslBandConfig): BandMaterials {
  const shared: BandSharedSlots = {
    uDustAvPerDensityPc: { value: 0 },
    uDustEnabled: { value: 0 },
    uExtinctionStrength: { value: 0 },
    uAnalyticalDustScaleLengthPc: { value: 0 },
    uAnalyticalDustScaleHeightPc: { value: 0 },
    uAnalyticalDustNormPerPc: { value: 0 },
    uReddeningRGB: { value: new THREE.Vector3() },
    uWorldOffset: { value: new THREE.Vector3() },
    uIcrsToGal: { value: new THREE.Matrix3() },
    uGalCenter: { value: new THREE.Vector3() },
    uR0Pc: { value: 0 },
    uGlowMagOffset: { value: 0 },
    uChartIsobar: { value: 0 },
    uChartInkColor: { value: new THREE.Color() },
  };
  seedBandSharedSlots(shared);
  return {
    shared,
    component(spec) {
      const material = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: milkywayVert,
        fragmentShader: milkywayFrag,
        // BackSide so each ray that intersects the volume produces exactly
        // one fragment — the back-face surface point IS the natural exit of
        // the volumetric integration; entry is computed analytically.
        side: THREE.BackSide,
        // depthTest on so the star core depth-mask (renderOrder −4) can
        // occlude this layer behind close-range disc stars; depthWrite off
        // so the mesh never occludes anything itself.
        depthTest: true,
        depthWrite: false,
        transparent: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
          ...shared,
          ...cfg.hdr,
          uLimitMag: cfg.uLimitMag,
          uIsBulge: { value: spec.isBulge },
          uMeshScalePc: { value: spec.meshScalePc },
          uDensity0: { value: spec.density0 },
          uColor: { value: spec.tint },
          uDiscScaleLengthPc: { value: spec.discScaleLengthPc },
          uDiscScaleHeightPc: { value: spec.discScaleHeightPc },
          uDiscThickScaleHeightPc: { value: spec.discThickScaleHeightPc },
          uDiscThickFraction: { value: spec.discThickFraction },
          uBulgeScaleRadiusPc: { value: spec.bulgeScaleRadiusPc },
          uBulgeAxisRatio: { value: spec.bulgeAxisRatio },
        },
      });
      return { material, uniforms: material.uniforms, dispose: () => material.dispose() };
    },
  };
}
