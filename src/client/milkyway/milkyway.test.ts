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
import {
  DEFAULT_INSTRUMENT,
  extendedThresholdSbFor,
  instrumentLimitMag,
} from '../filters/filter-state';
import {
  SB_ZERO_POINT,
  extendedThresholdSbFromSolidAngle,
  pixelSolidAngleArcsec2,
  surfaceBrightnessLuminance,
} from '../hdr/emission/emission-pure';
import {
  BASE_EPOCH_EXPOSURE,
  DEFAULT_SUMMATION_ARCSEC2,
} from '../hdr/exposure/exposure-epoch';
import { L_CAP } from '../hdr/exposure/scene-adaptation-pure';
import { angularToPx } from '../camera/controls/star-geometry';
import { FOV_MAX_DEG, FOV_MIN_DEG } from '../camera/timing';
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
      'uOmegaSummationArcsec2',
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

/** Reference viewport for every figure that still depends on plate scale
 *  — the statistic, and the pixel-solid-angle level the display path used
 *  to run on. */
const REFERENCE_OMEGA_PX = pixelSolidAngleArcsec2(
  angularToPx(900, (50 * Math.PI) / 180),
);

const displayLevel = (l: number) => srgbEncode(reinhardExtended(l, tonemapWhitePoint()));

/** Display level a sightline reaches at the base epoch. The rod summation
 *  solid angle, not the pixel's, so this carries no viewport. */
function bandDisplayLevel(magArcsec2: number): number {
  return displayLevel(
    surfaceBrightnessLuminance(
      BASE_EPOCH_EXPOSURE,
      magArcsec2,
      DEFAULT_SUMMATION_ARCSEC2,
    ),
  );
}

const sbAt = (lDeg: number, bDeg: number) =>
  sightlineSurfaceBrightness(
    SB_ZERO_POINT,
    SOL_GALACTOCENTRIC_PC,
    galacticDirection(lDeg, bDeg),
  );

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

  // The whole band, in 8-bit display levels at the base epoch with no EV
  // trim. Pinned as a table because the ORDERING is the acceptance — the
  // brightest sightline reads as a threshold star does and the pole sits at
  // the dither floor. Under the retired per-pixel mapping the same rows ran
  // 5.45 / 1.67 / 1.42 / 0.68 / 0.33 of 255, a seventh of a threshold star
  // at its brightest (docs/science-hdr-pipeline.md § 1, Extended sources).
  it('pins the band against a threshold star at the base epoch', () => {
    expect(displayLevel(L_THRESH) * 255).toBeCloseTo(38.25, 2);

    expect(bandDisplayLevel(sbAt(0, 5)) * 255).toBeCloseTo(38.07, 2);
    expect(bandDisplayLevel(GC_SIGHTLINE_MAG_ARCSEC2) * 255).toBeCloseTo(17.98, 2);
    expect(bandDisplayLevel(sbAt(180, 0)) * 255).toBeCloseTo(15.85, 2);
    expect(bandDisplayLevel(sbAt(0, 30)) * 255).toBeCloseTo(8.17, 2);
    expect(bandDisplayLevel(sbAt(0, 90)) * 255).toBeCloseTo(3.90, 2);
  });

  // How far under threshold each sightline sits, which is the photometric
  // statement the display levels above cannot make: they are tone-mapped and
  // sRGB-encoded, so a RATIO of them is not a magnitude and reads ~0.5 mag
  // shy of the real gap. Against S_lim it is a plain subtraction — no
  // operator, no encode, no viewport — and it is the column a future session
  // wants when asking whether a sightline should be visible at all.
  it('pins each sightline as a magnitude gap against the extended threshold', () => {
    const sLim = extendedThresholdSbFor(DEFAULT_INSTRUMENT);
    expect(sLim).toBe(22);

    expect(sbAt(0, 5) - sLim).toBeCloseTo(0.01, 2);
    expect(GC_SIGHTLINE_MAG_ARCSEC2 - sLim).toBeCloseTo(1.29, 2);
    expect(sbAt(180, 0) - sLim).toBeCloseTo(1.47, 2);
    expect(sbAt(0, 30) - sLim).toBeCloseTo(2.26, 2);
    expect(sbAt(0, 90) - sLim).toBeCloseTo(3.07, 2);

    // The band's maximum lands ON threshold, which is what the anchor pins;
    // a threshold star and a threshold surface brightness are the same
    // display level by construction (emission-pure.test.ts).
    expect(bandDisplayLevel(sLim)).toBeCloseTo(displayLevel(L_THRESH), 12);
  });

  // Rod summation is fixed in ANGLE, so narrowing the field cannot lose the
  // band: the display path takes no plate scale at all, which is why
  // `bandDisplayLevel` above has no viewport argument. What still dims
  // quadratically is the STATISTIC, and that is what keeps the concession
  // out of the adaptation cut.
  it('dims the statistic quadratically with FOV, not the display', () => {
    const zoomedPx = pixelSolidAngleArcsec2(angularToPx(900, (5 * Math.PI) / 180));
    const physical = (omega: number) =>
      surfaceBrightnessLuminance(BASE_EPOCH_EXPOSURE, SB_ZERO_POINT, omega);
    expect(physical(REFERENCE_OMEGA_PX) / physical(zoomedPx)).toBeCloseTo(100, 6);
    expect(physical(REFERENCE_OMEGA_PX)).toBeLessThan(
      physical(DEFAULT_SUMMATION_ARCSEC2),
    );
  });

  // Keeping the concession off attachment 1 is only safe if what the band
  // does write cannot provoke an adaptation cut. It cannot, by 10 stops —
  // and the margin is measured on the Ω_px value the statistic actually
  // carries, not on the 12x-larger level the band displays at
  // (attachments/README.md § The unit).
  it('writes a statistic the adaptation cut cannot act on', () => {
    const statisticL = surfaceBrightnessLuminance(
      BASE_EPOCH_EXPOSURE,
      sbAt(0, 5),
      REFERENCE_OMEGA_PX,
    );
    expect(statisticL).toBeCloseTo(1.657e-3, 6);
    expect(Math.log2(L_CAP / statisticL)).toBeCloseTo(10.1, 1);
  });

  // The footprint softening exists for the Local Group's Sérsic cusp and for
  // the band seen from outside; from Sol it must be inert, because the table
  // above is the shipped look. The camera sits INSIDE the disc, so the
  // footprint is metres over the near half of the march and a few parsecs at
  // the far rim — against a 300 pc scale height and a 3 kpc scale length. The
  // residual at 120° is 0.002 mag, so it cannot move a row pinned to 0.01.
  it('leaves every Sol sightline where it was, at both FOV extremes', () => {
    for (const fovDeg of [FOV_MIN_DEG, FOV_MAX_DEG]) {
      const omegaPxArcsec2 = pixelSolidAngleArcsec2(
        angularToPx(900, (fovDeg * Math.PI) / 180),
      );
      for (const [lDeg, bDeg] of [[0, 5], [0, 0], [180, 0], [0, 30], [0, 90]]) {
        const softened = sightlineSurfaceBrightness(
          SB_ZERO_POINT,
          SOL_GALACTOCENTRIC_PC,
          galacticDirection(lDeg, bDeg),
          { omegaPxArcsec2 },
        );
        expect(softened - sbAt(lDeg, bDeg)).toBeCloseTo(0, 2);
      }
    }
  });

  // What the concession is worth at the reference viewport, stated as the
  // magnitude offset between the two thresholds. It grows as the FOV
  // narrows, because the pixel shrinks and the summation patch does not.
  it('pins the extended-source lift at the reference viewport', () => {
    expect(2.5 * Math.log10(DEFAULT_SUMMATION_ARCSEC2 / REFERENCE_OMEGA_PX))
      .toBeCloseTo(2.695, 3);
    expect(
      extendedThresholdSbFromSolidAngle(
        DEFAULT_SUMMATION_ARCSEC2,
        instrumentLimitMag(DEFAULT_INSTRUMENT),
      ),
    ).toBeCloseTo(22, 9);
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

  // Which solid angle reaches which attachment is the whole fix, and it is
  // one argument order in one call — swap the pair and the band silently
  // returns to a seventh of a threshold star while the adaptation cut
  // starts reading the display concession as light.
  it('displays at the summation solid angle and measures at the pixel’s', () => {
    expect(frag).toMatch(
      /uExposure, uGlowMagOffset, uOmegaSummationArcsec2, uOmegaPxArcsec2,/,
    );
  });

  // A chart's band outline is a fixed feature of the sky, so the contour
  // must carry no plate-scale term — and the threshold it crosses is the
  // extended-source one, not the point-source m_lim it used to read.
  it('contours surface brightness against the extended-source threshold', () => {
    expect(frag).toMatch(/float sb = uGlowMagOffset - 2\.5 \* log\(column\)/);
    expect(frag).toMatch(
      /stellataExtendedThresholdSb\(uOmegaSummationArcsec2, uLimitMag\)/,
    );
    expect(frag).not.toMatch(/abs\(magPx - uLimitMag\)/);
  });
});
