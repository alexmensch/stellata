import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  GC_SIGHTLINE_COLUMN,
  GC_SIGHTLINE_MAG_ARCSEC2,
  MilkyWay,
} from './milkyway';
import {
  BULGE_COLOR_RGB,
  BULGE_TINT_RGB,
  DEFAULT_DUST_AV_PER_DENSITY_PC,
  DEFAULT_EXTINCTION_STRENGTH,
  DISC_COLOR_RGB,
  DISC_TINT_RGB,
  FOREGROUND_DUST_STEPS,
  LOCAL_DUST_RATE_MAG_PER_KPC,
  MAG_PER_TAU,
  SOL_GALACTOCENTRIC_PC,
  STEPS,
  S_MIN_PC,
  dustTauVPerPc,
  foregroundDustTauRgb,
  galacticDirection,
  sightlineSurfaceBrightness,
} from './milkyway-column-pure';
import { R0_PC } from '../galactic/galactic-coords';
import {
  LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2,
  NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2,
  RESOLVED_CATALOGUE_MAG_ARCSEC2,
  diffuseResidualMagArcsec2,
} from './diffuse-reference';
import { makeHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { DEFAULT_INSTRUMENT, instrumentLimitMag } from '../filters/filter-state';
import {
  SB_ZERO_POINT,
  pixelSolidAngleArcsec2,
  surfaceBrightnessLuminance,
} from '../hdr/emission-pure';
import { BASE_EPOCH_EXPOSURE } from '../hdr/exposure/exposure-epoch';
import { angularToPx } from '../camera/controls/star-geometry';
import {
  L_THRESH,
  relativeLuminance,
  srgbEncode,
  reinhardExtended,
  tonemapWhitePoint,
} from '../hdr/tonemap-pure';

function build() {
  const hdr = makeHdrEmitterUniforms();
  const uLimitMag = { value: instrumentLimitMag(DEFAULT_INSTRUMENT) };
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
    expect(v.glowMagOffset).toBe(SB_ZERO_POINT);
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

// The band's target is published starlight MINUS the stars the app already
// draws. Pinning the published figure directly would enshrine that double
// count, which is exactly what the retired GC anchor did.
describe('MilkyWay diffuse reference', () => {
  it('subtracts the resolved catalogue from the published NGP total', () => {
    expect(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2).toBeCloseTo(24.99, 2);
    expect(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2).toBeGreaterThan(
      LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole,
    );
  });

  // The resolved star field carries two thirds of the pole's starlight.
  it('pins how much of the NGP total the star field already draws', () => {
    const share =
      10 ** (-0.4 * RESOLVED_CATALOGUE_MAG_ARCSEC2.northGalacticPole) /
      10 ** (-0.4 * LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole);
    expect(share).toBeCloseTo(0.657, 3);
  });

  // De-extincted catalogue vs observed sky model through a ~30 mag column:
  // the pair is not commensurable and must not yield a number.
  it('refuses a residual toward the Galactic centre', () => {
    expect(
      diffuseResidualMagArcsec2(
        LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.galacticCentre,
        RESOLVED_CATALOGUE_MAG_ARCSEC2.galacticCentre,
      ),
    ).toBeNull();
  });
});

// A_V range the SFD map spans toward the galactic poles. The literature
// figure is an interval, so containment is the assertion; the model's own
// number is pinned exactly alongside it.
const SFD_POLAR_AV_MIN = 0.03;
const SFD_POLAR_AV_MAX = 0.15;

// Rod spatial summation integrates an extended source over roughly a
// degree of sky, which is why the band's naked-eye visibility is a
// different question from its per-pixel level.
const ROD_SUMMATION_PATCH_DEG = 1;
const ARCSEC_PER_DEG = 3600;

/** Display level the GC sightline reaches at the base epoch, on the
 *  reference 900 px / 50° viewport both display assertions use. */
function bandDisplayLevel(): number {
  const omega = pixelSolidAngleArcsec2(angularToPx(900, (50 * Math.PI) / 180));
  return srgbEncode(
    reinhardExtended(
      GC_SIGHTLINE_COLUMN *
        surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, SB_ZERO_POINT, omega),
      tonemapWhitePoint(),
    ),
  );
}

describe('MilkyWay analytical dust', () => {
  // Marched through the profile rather than re-arranged out of the
  // normalisation, so a change to the radial term, the A_V-per-density
  // wiring or a re-introduced 0.45 multiplier all show up here.
  // Schlegel/Finkbeiner/Davis publishes no per-kpc rate at all — the
  // figure this replaced cited it anyway.
  it('marches the stated plane rate at (R₀, z = 0)', () => {
    const magPerPc =
      dustTauVPerPc(R0_PC, 0, DEFAULT_EXTINCTION_STRENGTH) * MAG_PER_TAU;
    expect(magPerPc * 1000).toBeCloseTo(LOCAL_DUST_RATE_MAG_PER_KPC, 9);
    expect(LOCAL_DUST_RATE_MAG_PER_KPC).toBe(1.0);
  });

  // The second constraint the 1.0 mag/kpc rate has to satisfy, and the one
  // the scale height controls: integrate the slab straight up from Sol and
  // the perpendicular column has to land in SFD's polar range. Marched, so
  // moving ANALYTICAL_DUST_SCALE_HEIGHT_PC fails it — which is the whole
  // reason the two constraints are described as independent.
  it('lands the polar column inside the SFD polar spread', () => {
    const tau = foregroundDustTauRgb(
      SOL_GALACTOCENTRIC_PC,
      galacticDirection(0, 90),
      20_000,
      DEFAULT_EXTINCTION_STRENGTH,
      4096,
    );
    const av = tau[1] * MAG_PER_TAU;
    // 0.125 analytically; the march starts at S_MIN_PC like the shader's
    // does, which drops the first parsec (0.8%).
    expect(av).toBeCloseTo(0.124, 3);
    expect(av).toBeGreaterThan(SFD_POLAR_AV_MIN);
    expect(av).toBeLessThan(SFD_POLAR_AV_MAX);
  });

  // A multiplier of anything but 1 means the shipped extinction disagrees
  // with the anchor above. It shipped at 0.45 for a long time.
  it('keeps the dev multiplier out of the calibration', () => {
    expect(DEFAULT_EXTINCTION_STRENGTH).toBe(1.0);
  });

  // The normalisation divides by this constant, and attachDust overwrites
  // the *uniform* from the loaded manifest while leaving the *norm* derived
  // from the copy here. Disagree and the shipped rate is silently
  // LOCAL_DUST_RATE_MAG_PER_KPC x (manifest / this), not the stated 1.0.
  it('derives the norm at the A_V rate the shipped dust field carries', () => {
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../../../data/dust/manifest.json', import.meta.url)),
        'utf-8',
      ),
    ) as { avPerDensityPerPc: number };
    expect(DEFAULT_DUST_AV_PER_DENSITY_PC).toBe(manifest.avPerDensityPerPc);
  });
});

describe('MilkyWay surface-brightness calibration', () => {
  // Derived from the raymarch mirror rather than hand-tuned, so these pins
  // are what catch a profile / quadrature change.
  it('derives the GC column and the surface brightness it implies', () => {
    expect(GC_SIGHTLINE_COLUMN).toBeCloseTo(20.485, 3);
    expect(GC_SIGHTLINE_MAG_ARCSEC2).toBeCloseTo(23.29, 2);
  });

  // The anchor is set on the DUST-FREE pole, so the rendered pole sits a
  // little under it. Less than the slab's full 0.125 mag perpendicular
  // column, because the emission originates throughout the slab rather
  // than behind all of it.
  it('puts the NGP on the resolved-star-corrected residual', () => {
    const s = (lDeg: number, bDeg: number) =>
      sightlineSurfaceBrightness(
        SB_ZERO_POINT,
        SOL_GALACTOCENTRIC_PC,
        galacticDirection(lDeg, bDeg),
      );
    const dustFree = sightlineSurfaceBrightness(
      SB_ZERO_POINT,
      SOL_GALACTOCENTRIC_PC,
      galacticDirection(0, 90),
      { dustEnabled: false },
    );
    expect(dustFree).toBeCloseTo(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2, 6);
    expect(s(0, 90) - dustFree).toBeCloseTo(0.077, 3);
    expect(s(180, 0)).toBeCloseTo(23.47, 2);
    expect(s(0, 0)).toBeCloseTo(GC_SIGHTLINE_MAG_ARCSEC2, 6);
  });

  // Counterintuitive and worth holding: b = 0 is DIMMER than b = 5, because
  // the in-plane sightline eats the most dust. The real band has the same
  // shape — the dark rift is dust, not a gap in the stars.
  it('puts the plane minimum on the midplane, not at the pole', () => {
    const s = (bDeg: number) =>
      sightlineSurfaceBrightness(
        SB_ZERO_POINT,
        SOL_GALACTOCENTRIC_PC,
        galacticDirection(0, bDeg),
      );
    expect(s(5)).toBeLessThan(s(0));
    expect(s(5)).toBeCloseTo(22.01, 2);
    expect(s(0)).toBeCloseTo(23.29, 2);
  });

  // The whole point of the rework: extinction attenuates, it does not
  // set the luminosity. Moving the dust must leave the pole where it is.
  it('holds the emissivity scale independent of the dust', () => {
    const ngp = galacticDirection(0, 90);
    const at = (k: number) =>
      sightlineSurfaceBrightness(SB_ZERO_POINT, SOL_GALACTOCENTRIC_PC, ngp, {
        extinctionStrength: k,
      });
    expect(at(0)).toBeCloseTo(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2, 2);
    // Quadrupling the dust attenuates the pole and moves nothing else.
    // Pinned rather than bounded: a loose ceiling here would also pass if
    // the emissivity had silently re-coupled and cancelled the change.
    expect(at(4) - at(0)).toBeCloseTo(0.302, 3);
  });

  // The plane-to-pole contrast the retired anchor got wrong by 4 mag.
  it('pins the latitude contrast the dust normalisation sets', () => {
    const s = (lDeg: number, bDeg: number) =>
      sightlineSurfaceBrightness(
        SB_ZERO_POINT,
        SOL_GALACTOCENTRIC_PC,
        galacticDirection(lDeg, bDeg),
      );
    expect(s(0, 90) - s(0, 0)).toBeCloseTo(1.78, 2);
  });

  // At a realistic dust column the band is FAINT at the base epoch: the
  // GC sightline lands near 1.7/255, inside the range the resolve's dither
  // breaks up but well under the 4/255 the old 0.45-strength calibration
  // reached. The brightest part of the band (b ≈ 5°) is the one that
  // carries the layer visually. Lifting it is the exposure model's job —
  // DR_MAG is the lever, and `stellata-xypg.7` owns tuning it against
  // eso0932a. Do not raise the emissivity to compensate; that would put
  // the pole back above its measured residual.
  it('renders the band in the dither-resolvable toe at the base epoch', () => {
    expect(bandDisplayLevel()).toBeCloseTo(0.0066, 4);
    expect(bandDisplayLevel()).toBeGreaterThan(1 / 255);
    expect(bandDisplayLevel()).toBeLessThan(
      srgbEncode(reinhardExtended(0.02, tonemapWhitePoint())),
    );
  });

  // The band is faint on screen but not faint in the sky, and the two
  // disagree by a wide margin. Summed over a rod-summation patch the GC
  // sightline is well ABOVE the shipped instrument's limit, yet it renders
  // at a small fraction of a threshold star, because L_THRESH lifts point
  // sources to a comfortable display level and extended sources get no
  // equivalent concession. The retired 20.0 anchor was silently supplying
  // that lift.
  //
  // Pinned because these three figures are the whole case for the
  // extended-source threshold (README.md § Calibration), they are what a
  // future session will act on, and they were already computed once
  // against the wrong m_lim.
  it('pins the extended-source display gap against the shipped instrument', () => {
    const patchArcsec2 = (ROD_SUMMATION_PATCH_DEG * ARCSEC_PER_DEG) ** 2;
    const patchMag = GC_SIGHTLINE_MAG_ARCSEC2 - 2.5 * Math.log10(patchArcsec2);
    expect(patchMag).toBeCloseTo(5.51, 2);
    expect(instrumentLimitMag(DEFAULT_INSTRUMENT) - patchMag).toBeCloseTo(2.29, 2);

    const thresholdStar = srgbEncode(reinhardExtended(L_THRESH, tonemapWhitePoint()));
    expect(thresholdStar * 255).toBeCloseTo(38.3, 1);
    // Brighter than the limit by 2.29 mag, drawn at 1/23 of it.
    expect(thresholdStar / bandDisplayLevel()).toBeCloseTo(22.88, 2);
  });

  it('dims the band quadratically with FOV — magnification costs surface brightness', () => {
    const wide = pixelSolidAngleArcsec2(angularToPx(900, (50 * Math.PI) / 180));
    const zoomed = pixelSolidAngleArcsec2(angularToPx(900, (5 * Math.PI) / 180));
    const ratio =
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, SB_ZERO_POINT, wide) /
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, SB_ZERO_POINT, zoomed);
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
