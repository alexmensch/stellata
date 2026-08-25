// The renderer-neutral contract the two band components are built
// through, and the WebGL2 implementation. See README.md § The material seam.

import * as THREE from 'three';
import type { EmitterMaterial } from '../solar-system/materials/emitter-material';
import type { HdrEmitterUniforms } from '../hdr/hdr-pipeline';
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
  shared: BandSharedSlots;
  /** Exposure, both solid angles, and the inline-operator branch. */
  hdr: HdrEmitterUniforms;
  /** The instrument limit the chart isobar contours against. */
  uLimitMag: THREE.IUniform;
}

export function makeGlslBandMaterials(cfg: GlslBandConfig): BandMaterials {
  return {
    shared: cfg.shared,
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
          ...cfg.shared,
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
