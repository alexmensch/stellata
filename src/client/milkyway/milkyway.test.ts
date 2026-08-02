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
  BULGE_DENSITY0,
  BULGE_VOLUME_INTEGRAL,
  DISC_COLOR_RGB,
  DISC_DENSITY0,
  DISC_HALF_THICKNESS_PC,
  DISC_RADIUS_PC,
  DISC_SCALE_LENGTH_PC,
  DISC_VOLUME_INTEGRAL,
  DISC_SCALE_HEIGHT_PC,
  DISC_THICK_DENSITY_FRACTION,
  DISC_THICK_SCALE_HEIGHT_PC,
  DISC_TINT_RGB,
  FOREGROUND_DUST_STEPS,
  discVerticalProfile,
  sightlineColumn,
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
import { integrateOverEllipsoid } from '../hdr/emission/density0-solver-pure';
import {
  BULGE_TO_TOTAL_V,
  GALAXY_TOTAL_ABSMAG_V,
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

  // An unbound uniform reads 0 in GLSL, so a missing thick-disc binding
  // deletes the term silently — no compile error, no visible change from
  // Sol, and the external edge-on view quietly loses its halo.
  it('binds the thick-disc term in both components', () => {
    const { materials } = build();
    for (const mat of materials) {
      expect(mat.uniforms.uDiscThickScaleHeightPc.value).toBe(
        DISC_THICK_SCALE_HEIGHT_PC,
      );
      expect(mat.uniforms.uDiscThickFraction.value).toBe(
        DISC_THICK_DENSITY_FRACTION,
      );
    }
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

// Bland-Hawthorn & Gerhard 2016 § 5.1. The thick disc is for the EXTERNAL
// edge-on view — from Sol it is a small correction, and it is emphatically
// not a fix for a high-latitude deficit (README.md § Density profiles).
describe('MilkyWay vertical profile', () => {
  it('pins the thin/thick split against BHG16 § 5.1', () => {
    expect(DISC_SCALE_HEIGHT_PC).toBe(300);
    expect(DISC_THICK_SCALE_HEIGHT_PC).toBe(900);
    expect(DISC_THICK_DENSITY_FRACTION).toBe(0.04);
    expect(discVerticalProfile(0)).toBeCloseTo(1.04, 12);
  });

  // The thick disc's share of the vertical column, which is the number the
  // external cross-check disagrees with: Mosenkov et al. 2021 measure a
  // thick/thin LUMINOSITY ratio of 0.71 ± 0.45 at 3.4 µm, against 0.12
  // here. Their thick disc also carries a longer radial scale length and
  // this model gives both components the same one, so the two are not the
  // same quantity — stated rather than tuned (README.md § Density profiles).
  it('pins the thick/thin luminosity ratio the shared scale length implies', () => {
    const thin = DISC_SCALE_HEIGHT_PC;
    const thick = DISC_THICK_DENSITY_FRACTION * DISC_THICK_SCALE_HEIGHT_PC;
    expect(thick / thin).toBeCloseTo(0.12, 12);
  });

  // The envelope is two thick scale heights, the same rule 600 pc followed
  // against the thin one. Pinned as the magnitude it clips off the vertical
  // column, because that is what a reader wants when asking whether the
  // envelope is tight enough — and it is 8x better than the 0.158 mag the
  // 600 pc envelope cost.
  it('clips a stated fraction of the vertical column at the envelope', () => {
    expect(DISC_HALF_THICKNESS_PC).toBe(2 * DISC_THICK_SCALE_HEIGHT_PC);
    const column = (limitPc: number) =>
      DISC_SCALE_HEIGHT_PC * (1 - Math.exp(-limitPc / DISC_SCALE_HEIGHT_PC)) +
      DISC_THICK_DENSITY_FRACTION *
        DISC_THICK_SCALE_HEIGHT_PC *
        (1 - Math.exp(-limitPc / DISC_THICK_SCALE_HEIGHT_PC));
    const loss =
      -2.5 * Math.log10(column(DISC_HALF_THICKNESS_PC) / column(Infinity));
    expect(loss).toBeCloseTo(0.0183, 4);
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

// The emissivity is solved against the Galaxy's integrated luminosity, so
// the solve itself has no tolerance — it either reproduces the published
// pair or it does not. What DOES have a tolerance is every check the solve
// is not anchored on, and those disagreements are the deliverable
// (README.md § Calibration).
describe('MilkyWay luminosity solve', () => {
  const totalFlux =
    DISC_DENSITY0 * DISC_VOLUME_INTEGRAL + BULGE_DENSITY0 * BULGE_VOLUME_INTEGRAL;
  const modelAbsMagV = -2.5 * Math.log10(totalFlux / 100);

  it('integrates both proxy volumes back to the published M_V and B/T', () => {
    expect(GALAXY_TOTAL_ABSMAG_V).toBe(-21.37);
    expect(modelAbsMagV).toBeCloseTo(GALAXY_TOTAL_ABSMAG_V, 12);
    expect((BULGE_DENSITY0 * BULGE_VOLUME_INTEGRAL) / totalFlux).toBeCloseTo(
      BULGE_TO_TOTAL_V,
      12,
    );
  });

  // The envelope clips real light and ρ₀ makes it up, so a tighter envelope
  // BRIGHTENS what is left rather than losing it. Pinned because that is
  // the one way the truncation can bite: it is silent in the total and
  // visible only in the profile it redistributes.
  it('compensates the disc envelope truncation into ρ₀', () => {
    const loose = 20_000;
    const untruncated = integrateOverEllipsoid(
      (r, c) =>
        Math.exp(
          -(DISC_RADIUS_PC * r * Math.sqrt(1 - c * c) - R0_PC) /
            DISC_SCALE_LENGTH_PC,
        ) * discVerticalProfile(Math.abs(loose * r * c)),
      [DISC_RADIUS_PC, DISC_RADIUS_PC, loose],
    );
    expect(-2.5 * Math.log10(DISC_VOLUME_INTEGRAL / untruncated)).toBeCloseTo(
      0.0308,
      4,
    );
  });

  // Check 1, the sightline the model used to be anchored ON. A single
  // sightline cannot constrain a luminosity, and this is by how much the
  // two disagree once it stops trying: the solve puts the pole 1.59 mag
  // brighter than Leinert's total minus the star field the app draws.
  it('states the NGP residual as a check, and by how much it disagrees', () => {
    const dustFree =
      SB_ZERO_POINT -
      2.5 *
        Math.log10(
          sightlineColumn(SOL_GALACTOCENTRIC_PC, galacticDirection(0, 90), {
            dustEnabled: false,
          }),
        );
    expect(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2 - dustFree).toBeCloseTo(1.587, 3);
  });

  // Check 2, the sightline the ORIGINAL anchor used. Compared against
  // Leinert's total rather than a residual: the catalogue row toward the
  // centre is de-extincted and so not commensurable there
  // (diffuse-reference.ts), and it would only widen the gap. Same species
  // of disagreement as the pole, which is what says it is a scale
  // difference between two published sources and not a shape error.
  it('states the Galactic-centre sightline against Leinert’s total', () => {
    expect(
      LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.galacticCentre -
        GC_SIGHTLINE_MAG_ARCSEC2,
    ).toBeCloseTo(0.936, 3);
  });

  // The cross-layer symptom the epic opened on: the Galaxy seen from M31
  // has to be at least as bright as M31 seen from here, and under the
  // sightline anchor it was 1.11 mag fainter. M31's own photometry is read
  // from the build's source of truth so a catalogue edit moves this pin
  // rather than silently invalidating it.
  it('orders the Galaxy from M31 against M31 from Sol', () => {
    const row = readFileSync(
      fileURLToPath(new URL('../../../data/local-group/overrides.tsv', import.meta.url)),
      'utf-8',
    )
      .split('\n')
      .find((l) => l.startsWith('M31\t'));
    if (row === undefined) throw new Error('M31 row missing from overrides.tsv');
    const cols = row.split('\t');
    const m31DistancePc = Number(cols[8]) * 1000;
    const m31ApparentV = Number(cols[9]);
    expect(m31ApparentV).toBeCloseTo(3.44, 6);

    const galaxyFromM31 =
      modelAbsMagV + 5 * Math.log10(m31DistancePc / 10);
    expect(galaxyFromM31).toBeCloseTo(3.079, 3);
    expect(galaxyFromM31).toBeLessThan(m31ApparentV);
    expect(m31ApparentV - galaxyFromM31).toBeCloseTo(0.361, 3);
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
    expect(GC_SIGHTLINE_COLUMN).toBeCloseTo(68.419, 3);
    expect(GC_SIGHTLINE_MAG_ARCSEC2).toBeCloseTo(21.98, 2);
  });

  // The emissivity is solved against a luminosity, not a sightline, so the
  // dust only attenuates. Less than the slab's full 0.125 mag perpendicular
  // column, because the emission originates throughout the slab rather
  // than behind all of it.
  it('attenuates the pole by the slab it sits inside', () => {
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
    expect(s(0, 90) - dustFree).toBeCloseTo(0.087, 3);
    expect(s(180, 0)).toBeCloseTo(22.16, 2);
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
    expect(s(5)).toBeCloseTo(20.71, 2);
    expect(s(0)).toBeCloseTo(21.98, 2);
  });

  // The whole point of the rework: extinction attenuates, it does not
  // set the luminosity. Moving the dust must leave the emissivity alone.
  it('holds the emissivity scale independent of the dust', () => {
    const ngp = galacticDirection(0, 90);
    const at = (k: number) =>
      sightlineSurfaceBrightness(SB_ZERO_POINT, SOL_GALACTOCENTRIC_PC, ngp, {
        extinctionStrength: k,
      });
    // ρ₀ is solved over the profile's volume with no extinction term at
    // all, so switching the dust off has to land exactly on the dust-free
    // march rather than merely near it.
    expect(at(0)).toBeCloseTo(
      sightlineSurfaceBrightness(SB_ZERO_POINT, SOL_GALACTOCENTRIC_PC, ngp, {
        dustEnabled: false,
      }),
      12,
    );
    // Quadrupling the dust attenuates the pole and moves nothing else.
    // Pinned rather than bounded: a loose ceiling here would also pass if
    // the emissivity had silently re-coupled and cancelled the change.
    expect(at(4) - at(0)).toBeCloseTo(0.339, 3);
  });

  // The plane-to-pole contrast the retired anchor got wrong by 4 mag.
  it('pins the latitude contrast the dust normalisation sets', () => {
    const s = (lDeg: number, bDeg: number) =>
      sightlineSurfaceBrightness(
        SB_ZERO_POINT,
        SOL_GALACTOCENTRIC_PC,
        galacticDirection(lDeg, bDeg),
      );
    expect(s(0, 90) - s(0, 0)).toBeCloseTo(1.51, 2);
  });

  // The whole band, in 8-bit display levels at the base epoch with no EV
  // trim. Pinned as a table because the ORDERING is the acceptance. Under
  // the sightline anchor the same rows ran 35.95 / 14.76 / 12.85 / 8.66 /
  // 3.86 of 255 — the luminosity solve is 1.6 mag brighter everywhere, so
  // the brightest sightline is now most of TWO threshold stars and the
  // pole has left the dither floor (README.md § Calibration).
  it('pins the band against a threshold star at the base epoch', () => {
    expect(displayLevel(L_THRESH) * 255).toBeCloseTo(38.25, 2);

    expect(bandDisplayLevel(sbAt(0, 5)) * 255).toBeCloseTo(70.33, 2);
    expect(bandDisplayLevel(GC_SIGHTLINE_MAG_ARCSEC2) * 255).toBeCloseTo(38.56, 2);
    expect(bandDisplayLevel(sbAt(180, 0)) * 255).toBeCloseTo(35.12, 2);
    expect(bandDisplayLevel(sbAt(0, 30)) * 255).toBeCloseTo(27.43, 2);
    expect(bandDisplayLevel(sbAt(0, 90)) * 255).toBeCloseTo(15.65, 2);
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

    expect(sbAt(0, 5) - sLim).toBeCloseTo(-1.29, 2);
    expect(GC_SIGHTLINE_MAG_ARCSEC2 - sLim).toBeCloseTo(-0.02, 2);
    expect(sbAt(180, 0) - sLim).toBeCloseTo(0.16, 2);
    expect(sbAt(0, 30) - sLim).toBeCloseTo(0.61, 2);
    expect(sbAt(0, 90) - sLim).toBeCloseTo(1.49, 2);

    // Negative is OVER threshold. Nothing pins the band to it any more —
    // the solve is against a luminosity, and where the plane lands against
    // the eye's detection limit is now an outcome. A threshold star and a
    // threshold surface brightness are still the same display level by
    // construction (emission-pure.test.ts), which is what makes the column
    // above readable at all.
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
    expect(statisticL).toBeCloseTo(5.507e-3, 6);
    expect(Math.log2(L_CAP / statisticL)).toBeCloseTo(8.4, 1);
  });

  // The footprint softening exists for the Local Group's Sérsic cusp and for
  // the band seen from outside; from Sol it must be inert, because the table
  // above is the shipped look. The camera sits INSIDE the disc, so the
  // footprint is metres over the near half of the march and a few parsecs at
  // the far rim — against a 300 pc scale height and a 3 kpc scale length. The
  // worst residual is 0.0029 mag, so it cannot move a row pinned to 0.01.
  it('leaves every Sol sightline where it was, at both FOV extremes', () => {
    let worst = 0;
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
        worst = Math.max(worst, Math.abs(softened - sbAt(lDeg, bDeg)));
      }
    }
    // Pinned rather than bounded: the figure the READMEs quote is this one,
    // and a two-place tolerance would have let 0.005 through.
    expect(worst).toBeCloseTo(0.00278, 5);
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

  // The vertical profile is two exponentials on ONE softened |z|, not two
  // independent softenings — the footprint correction is a property of the
  // sample, not of the component it feeds.
  it('sums both vertical exponentials over one softened |z|', () => {
    expect(frag).toMatch(
      /float absZ = stellataSoftenRadius\(abs\(zVal\), zFootprintPc\);/,
    );
    expect(frag).toMatch(
      /exp\(-absZ \/ uDiscScaleHeightPc\)\s*\+ uDiscThickFraction \* exp\(-absZ \/ uDiscThickScaleHeightPc\)/,
    );
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
