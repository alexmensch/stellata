import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms, pickHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../webgpu/tsl/shared-uniform-nodes';
import { makeTslBandMaterials } from '../webgpu/milkyway/tsl-band-materials';
import {
  makeGlslBandMaterials,
  type BandComponentSpec,
  type BandMaterials,
  type BandSharedSlots,
} from './band-materials';

const hdr = makeHdrEmitterUniforms();
const uLimitMag = { value: 6.5 };

function glslShared(): BandSharedSlots {
  return {
    uDustAvPerDensityPc: { value: 2.742 },
    uDustEnabled: { value: 0 },
    uExtinctionStrength: { value: 1 },
    uAnalyticalDustScaleLengthPc: { value: 3500 },
    uAnalyticalDustScaleHeightPc: { value: 125 },
    uAnalyticalDustNormPerPc: { value: 1e-4 },
    uReddeningRGB: { value: new THREE.Vector3(0.76, 1, 1.35) },
    uWorldOffset: { value: new THREE.Vector3() },
    uIcrsToGal: { value: new THREE.Matrix3() },
    uGalCenter: { value: new THREE.Vector3() },
    uR0Pc: { value: 8200 },
    uGlowMagOffset: { value: 26.57 },
    uChartIsobar: { value: 0 },
    uChartInkColor: { value: new THREE.Color(0x000000) },
  };
}

const spec = (isBulge: boolean): BandComponentSpec => ({
  isBulge,
  meshScalePc: new THREE.Vector3(15000, 15000, 1800),
  density0: 1.5,
  tint: new THREE.Color(1, 0.9, 0.8),
  discScaleLengthPc: 3000,
  discScaleHeightPc: 300,
  discThickScaleHeightPc: 900,
  discThickFraction: 0.04,
  bulgeScaleRadiusPc: 1000,
  bulgeAxisRatio: 0.6,
});

function tsl(registerMrtLayer = () => () => {}): BandMaterials {
  const shared = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
  });
  return makeTslBandMaterials({
    nodes: buildSharedUniformNodes(shared).nodes,
    registerMrtLayer,
  });
}

const HDR_KEYS = Object.keys(pickHdrEmitterUniforms(hdr));
/** Off the shared node mirror on the TSL path, so absent from its record. */
const FROM_MIRROR = [...HDR_KEYS, 'uLimitMag'];
/** A uniform on the GLSL path; a builder flag here. */
const COMPILE_TIME = ['uIsBulge'];

describe('the band material seam', () => {
  for (const isBulge of [false, true]) {
    const name = isBulge ? 'bulge' : 'disc';
    it(`gives the ${name} the same driven slots on both backends`, () => {
      const glsl = makeGlslBandMaterials({ shared: glslShared(), hdr, uLimitMag });
      const glslKeys = Object.keys(glsl.component(spec(isBulge)).uniforms)
        .filter((k) => !FROM_MIRROR.includes(k) && !COMPILE_TIME.includes(k));
      const tslKeys = Object.keys(tsl().component(spec(isBulge)).uniforms);
      expect(tslKeys.sort()).toEqual(glslKeys.sort());
    });
  }

  // The whole point of the shared group: one slider write reaches both
  // draws. A factory per component would give two dust models that agreed
  // only until the first move.
  it('hands the disc and the bulge the SAME shared slots', () => {
    const materials = tsl();
    const disc = materials.component(spec(false)).uniforms;
    const bulge = materials.component(spec(true)).uniforms;
    expect(disc.uExtinctionStrength).toBe(bulge.uExtinctionStrength);
    expect(disc.uReddeningRGB).toBe(bulge.uReddeningRGB);
    expect(disc.uChartIsobar).toBe(bulge.uChartIsobar);

    disc.uExtinctionStrength.value = 0.25;
    expect(bulge.uExtinctionStrength.value).toBe(0.25);
  });

  it('keeps the per-component slots distinct', () => {
    const materials = tsl();
    const disc = materials.component(spec(false)).uniforms;
    const bulge = materials.component(spec(true)).uniforms;
    expect(disc.uDensity0).not.toBe(bulge.uDensity0);
    disc.uDensity0.value = 9;
    expect(bulge.uDensity0.value).not.toBe(9);
  });

  it('exposes the same shared objects through `shared` and through a component', () => {
    const materials = tsl();
    const comp = materials.component(spec(false)).uniforms;
    expect(comp.uGlowMagOffset).toBe(materials.shared.uGlowMagOffset);
  });

  it('gives the two components distinct materials on both backends', () => {
    const glsl = makeGlslBandMaterials({ shared: glslShared(), hdr, uLimitMag });
    expect(glsl.component(spec(true)).material)
      .not.toBe(glsl.component(spec(false)).material);
    const t = tsl();
    expect(t.component(spec(true)).material).not.toBe(t.component(spec(false)).material);
  });

  it('keeps the additive back-face render contract on both backends', () => {
    const glsl = makeGlslBandMaterials({ shared: glslShared(), hdr, uLimitMag });
    for (const m of [glsl.component(spec(false)).material,
      tsl().component(spec(false)).material]) {
      expect(m.side).toBe(THREE.BackSide);
      expect(m.blending).toBe(THREE.AdditiveBlending);
      expect(m.depthWrite).toBe(false);
    }
  });

  it('severs every MRT registration on dispose', () => {
    let live = 0;
    const materials = tsl(() => {
      live++;
      return () => { live--; };
    });
    const d = materials.component(spec(false));
    const b = materials.component(spec(true));
    expect(live).toBe(2);
    d.dispose();
    b.dispose();
    expect(live).toBe(0);
  });
});
