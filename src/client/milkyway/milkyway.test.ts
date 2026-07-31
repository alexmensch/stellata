import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  GC_BAND_REFERENCE_MAG_ARCSEC2,
  GC_SIGHTLINE_COLUMN,
  GLOW_MAG_OFFSET,
  MilkyWay,
} from './milkyway';
import {
  BULGE_COLOR_RGB,
  BULGE_TINT_RGB,
  DISC_COLOR_RGB,
  DISC_TINT_RGB,
  FOREGROUND_DUST_STEPS,
  MAG_PER_TAU,
  SOL_GALACTOCENTRIC_PC,
  STEPS,
  S_MIN_PC,
  galacticDirection,
  sightlineSurfaceBrightness,
} from './milkyway-column-pure';
import { makeHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { pixelSolidAngleArcsec2, surfaceBrightnessLuminance } from '../hdr/emission-pure';
import { BASE_EPOCH_EXPOSURE } from '../hdr/exposure/exposure-epoch';
import { angularToPx } from '../camera/controls/star-geometry';
import {
  relativeLuminance,
  srgbEncode,
  reinhardExtended,
  tonemapWhitePoint,
} from '../hdr/tonemap-pure';

function build() {
  const hdr = makeHdrEmitterUniforms();
  const uLimitMag = { value: 6.5 };
  const layer = new MilkyWay({ uLimitMag, hdr });
  const materials = layer.group.children.map(
    (m) => (m as THREE.Mesh).material as THREE.ShaderMaterial,
  );
  return { layer, hdr, uLimitMag, materials };
}

describe('MilkyWay uniform wiring', () => {
  it('binds the HDR seam by reference in both components', () => {
    const { hdr, materials } = build();
    expect(materials).toHaveLength(2);
    for (const key of [
      'uHdrTarget',
      'uWhitePoint',
      'uHighlightDesat',
      'uExposure',
      'uOmegaPxArcsec2',
    ] as const) {
      for (const mat of materials) expect(mat.uniforms[key]).toBe(hdr[key]);
    }
  });

  it('shares the star pipeline’s uLimitMag for the chart isobar', () => {
    const { uLimitMag, materials } = build();
    for (const mat of materials) expect(mat.uniforms.uLimitMag).toBe(uLimitMag);
  });

  // The layer emits physical luminance now; the per-layer squash and the
  // magnitude gate it needed are gone, not merely off the debug panel
  // (docs/science-hdr-pipeline.md § 9).
  it('carries neither the retired brightness scalar nor the gate input', () => {
    const { materials } = build();
    for (const mat of materials) {
      expect(mat.uniforms.uBrightnessScale).toBeUndefined();
      expect(mat.uniforms.uSizeSpan).toBeUndefined();
    }
  });

  it('exposes glowMagOffset as the only photometric knob left', () => {
    const { layer } = build();
    const v = layer.getValues();
    expect(v.glowMagOffset).toBe(GLOW_MAG_OFFSET);
    expect(v).not.toHaveProperty('brightness');
  });

  it('binds the luma-normalised tint, not the authored palette', () => {
    const { materials } = build();
    const [disc, bulge] = materials.map((m) => m.uniforms.uColor.value as THREE.Color);
    expect([disc.r, disc.g, disc.b]).toEqual([...DISC_TINT_RGB]);
    expect([bulge.r, bulge.g, bulge.b]).toEqual([...BULGE_TINT_RGB]);
  });

  // The colour picker round-trips the authored hue; feeding the normalised
  // tint back into it would drift the palette a channel at a time.
  it('reports the authored palette to the tuning panel', () => {
    const { layer } = build();
    const v = layer.getValues();
    expect([v.discColor.r, v.discColor.g, v.discColor.b]).toEqual([...DISC_COLOR_RGB]);
    layer.setDiscColor(0.2, 0.4, 0.8);
    expect(layer.getValues().discColor).toEqual({ r: 0.2, g: 0.4, b: 0.8 });
  });
});

// Population tints carry hue, never flux: the shader multiplies the scalar
// surface-brightness gain by the tint per channel, so a tint whose relative
// luminance isn't 1 rescales its own component's emission.
describe('MilkyWay population tints', () => {
  it('holds both component tints at unit relative luminance', () => {
    expect(relativeLuminance(DISC_TINT_RGB)).toBeCloseTo(1, 12);
    expect(relativeLuminance(BULGE_TINT_RGB)).toBeCloseTo(1, 12);
  });

  // What the authored palette used to cost: the bulge rode 0.390 mag
  // brighter than the disc purely because its hue is nearer white.
  it('pins the bulge-vs-disc flux split the authored palette carried', () => {
    const shift =
      2.5 *
      Math.log10(relativeLuminance(BULGE_COLOR_RGB) / relativeLuminance(DISC_COLOR_RGB));
    expect(shift).toBeCloseTo(0.3903, 4);
  });

  it('keeps a colour-picker edit off the flux', () => {
    const { layer, materials } = build();
    layer.setBulgeColor(0.1, 0.9, 0.3);
    const c = materials[1].uniforms.uColor.value as THREE.Color;
    expect(relativeLuminance([c.r, c.g, c.b])).toBeCloseTo(1, 12);
  });
});

describe('MilkyWay surface-brightness calibration', () => {
  // Both derived from the raymarch mirror rather than hand-tuned, so
  // these pins are what catch a profile / quadrature change.
  it('derives the GC column and the offset it anchors', () => {
    expect(GC_SIGHTLINE_COLUMN / 1e4).toBeCloseTo(3.6302, 4);
    expect(GLOW_MAG_OFFSET).toBeCloseTo(31.400, 3);
  });

  // The latitude gradient the offset implies. Steeper than the real sky
  // (NGP integrated starlight is ~23.5–24), which is a density-profile
  // question rather than an offset one — H7's call.
  it('places the band on its documented latitude gradient', () => {
    const s = (lDeg: number, bDeg: number) =>
      sightlineSurfaceBrightness(
        GLOW_MAG_OFFSET,
        SOL_GALACTOCENTRIC_PC,
        galacticDirection(lDeg, bDeg),
      );
    expect(s(0, 0)).toBeCloseTo(GC_BAND_REFERENCE_MAG_ARCSEC2, 6);
    expect(s(180, 0)).toBeCloseTo(22.47, 2);
    expect(s(0, 90)).toBeCloseTo(25.00, 2);
  });

  // Faint-but-present at strict physicality: the band sits well below a
  // threshold star's 0.15 of full scale and above the 8-bit floor the
  // resolve's dither breaks up. DR_MAG is the lever H7 tunes.
  it('renders the GC band in the visible toe at the base epoch', () => {
    const omega = pixelSolidAngleArcsec2(angularToPx(900, (50 * Math.PI) / 180));
    const y =
      GC_SIGHTLINE_COLUMN *
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, GLOW_MAG_OFFSET, omega);
    const display = srgbEncode(reinhardExtended(y, tonemapWhitePoint()));
    expect(display).toBeGreaterThan(4 / 255);
    expect(display).toBeLessThan(srgbEncode(reinhardExtended(0.02, tonemapWhitePoint())));
  });

  it('dims the band quadratically with FOV — magnification costs surface brightness', () => {
    const wide = pixelSolidAngleArcsec2(angularToPx(900, (50 * Math.PI) / 180));
    const zoomed = pixelSolidAngleArcsec2(angularToPx(900, (5 * Math.PI) / 180));
    const ratio =
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, GLOW_MAG_OFFSET, wide) /
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, GLOW_MAG_OFFSET, zoomed);
    expect(ratio).toBeCloseTo(100, 6);
  });
});

// The CPU mirror is only worth its constants if it marches the same way
// the shader does. Nothing at compile time ties the two sides together.
describe('raymarch parameters the mirror duplicates from GLSL', () => {
  const frag = readFileSync(
    fileURLToPath(new URL('./milkyway.frag.glsl', import.meta.url)),
    'utf8',
  );
  const glslConst = (decl: string, name: string): number => {
    const m = frag.match(
      new RegExp(`const ${decl}\\s+${name}\\s*=\\s*([\\d.]+);`),
    );
    if (m === null) throw new Error(`${name} not declared in milkyway.frag.glsl`);
    return Number(m[1]);
  };

  it('agrees on the in-volume step count and near clamp', () => {
    expect(glslConst('int', 'STEPS')).toBe(STEPS);
    expect(glslConst('float', 'S_MIN_PC')).toBe(S_MIN_PC);
  });

  it('agrees on the foreground pre-march step count', () => {
    expect(glslConst('int', 'FOREGROUND_DUST_STEPS')).toBe(FOREGROUND_DUST_STEPS);
  });

  it('agrees on the τ→magnitude conversion', () => {
    expect(glslConst('float', 'MAG_PER_TAU')).toBe(MAG_PER_TAU);
  });

  // The pre-march has to seed the accumulator, not be computed and
  // dropped — the failure mode a reader can't see from the constants.
  it('seeds tauAccum from the foreground column', () => {
    expect(frag).toMatch(/vec3 tauAccum = foregroundDustTau\(/);
  });
});
