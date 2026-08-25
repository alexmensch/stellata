import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms, pickHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../webgpu/tsl/shared-uniform-nodes';
import { makeTslBandMaterials } from '../webgpu/milkyway/tsl-band-materials';
import {
  makeGlslBandMaterials,
  seedBandSharedSlots,
  type BandComponentSpec,
  type BandMaterials,
  type BandSharedSlots,
} from './band-materials';

const hdr = makeHdrEmitterUniforms();
const uLimitMag = { value: 6.5 };
const glsl = () => makeGlslBandMaterials({ hdr, uLimitMag });

/** A value no authored constant takes, in every slot. The record is typed
 *  as BandSharedSlots, so a new slot fails to compile here before it can
 *  fail the assertion — which is what makes the seeding list unforgettable
 *  rather than merely tested. */
const UNSEEDED = -987654;
function unseededSlots(): BandSharedSlots {
  const n = () => ({ value: UNSEEDED });
  const v = () => ({ value: new THREE.Vector3(UNSEEDED, UNSEEDED, UNSEEDED) });
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
      UNSEEDED, UNSEEDED, UNSEEDED,
      UNSEEDED, UNSEEDED, UNSEEDED,
      UNSEEDED, UNSEEDED, UNSEEDED) },
    uGalCenter: v(),
    uR0Pc: n(),
    uGlowMagOffset: n(),
    uChartIsobar: n(),
    uChartInkColor: { value: new THREE.Color().setRGB(UNSEEDED, UNSEEDED, UNSEEDED) },
  };
}

/** One representative scalar per slot-value kind, for the sentinel sweep. */
function probe(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value instanceof THREE.Vector3) return value.x;
  if (value instanceof THREE.Matrix3) return value.elements[0];
  if (value instanceof THREE.Color) return value.r;
  throw new Error(`unhandled shared-slot value kind: ${String(value)}`);
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
      const glslKeys = Object.keys(glsl().component(spec(isBulge)).uniforms)
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
    const g = glsl();
    expect(g.component(spec(true)).material)
      .not.toBe(g.component(spec(false)).material);
    const t = tsl();
    expect(t.component(spec(true)).material).not.toBe(t.component(spec(false)).material);
  });

  it('keeps the additive back-face render contract on both backends', () => {
    for (const m of [glsl().component(spec(false)).material,
      tsl().component(spec(false)).material]) {
      expect(m.side).toBe(THREE.BackSide);
      expect(m.blending).toBe(THREE.AdditiveBlending);
      expect(m.depthWrite).toBe(false);
    }
  });

  // The trap the shared-node shape introduces: a TSL uniform starts on a
  // declared literal, so a slot the seeder forgets marches the placeholder
  // with no error and no missing draw.
  it('seeds every shared slot, leaving no placeholder behind', () => {
    const slots = unseededSlots();
    seedBandSharedSlots(slots);
    for (const [key, slot] of Object.entries(slots)) {
      expect(probe(slot.value), `${key} was never seeded`).not.toBe(UNSEEDED);
    }
  });

  it('starts both backends on the same authored values', () => {
    const g = glsl().shared;
    const t = tsl().shared;
    for (const key of Object.keys(g) as (keyof BandSharedSlots)[]) {
      expect(probe(t[key].value), key).toBeCloseTo(probe(g[key].value), 12);
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
