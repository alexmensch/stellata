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
  BULGE_COMPONENT,
  DISC_COMPONENT,
  type MilkywayComponent,
  componentColumnRgb,
  BULGE_DENSITY0,
  BULGE_TINT_RGB,
  BULGE_VOLUME_INTEGRAL,
  DEFAULT_DUST_AV_PER_DENSITY_PC,
  DEFAULT_EXTINCTION_STRENGTH,
  DISC_COLOR_RGB,
  DISC_DENSITY0,
  DISC_HALF_THICKNESS_PC,
  DISC_SCALE_HEIGHT_PC,
  DISC_SCALE_LENGTH_PC,
  DISC_THICK_DENSITY_FRACTION,
  DISC_THICK_SCALE_HEIGHT_PC,
  DISC_TINT_RGB,
  DISC_VOLUME_INTEGRAL,
  FOREGROUND_DUST_STEPS,
  LOCAL_DUST_RATE_MAG_PER_KPC,
  MAG_PER_TAU,
  SOL_GALACTOCENTRIC_PC,
  STEPS,
  S_MIN_PC,
  type Vec3,
  componentLuminanceShare,
  discVerticalProfile,
  dustTauVPerPc,
  foregroundDustTauRgb,
  galacticDirection,
  sightlineColumn,
  sightlineSurfaceBrightness,
} from './milkyway-column-pure';
import { R0_PC } from '../galactic/galactic-coords';
import { ABSOLUTE_MAGNITUDE_DISTANCE_PC } from '../hdr/emission/density0-solver-pure';
import { parseOverrides } from '../../../scripts/local-group/build-local-group';
import {
  BULGE_COLOUR_INDEX_BV,
  BULGE_TO_TOTAL_LIGHT_V,
  DISC_COLOUR_INDEX_BV,
  GALAXY_TOTAL_ABSMAG_V,
  LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2,
  NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2,
} from './calibration/diffuse-reference';
import { linearSrgbFromColourIndex } from '../../../scripts/colour/blackbody-lut-pure';
import { makeHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import {
  DEFAULT_INSTRUMENT,
  extendedThresholdSbFor,
  instrumentLimitMag,
} from '../filters/filter-state';
import {
  SB_ZERO_POINT,
  extendedThresholdSbFromSolidAngle,
  lumaNormalisedTint,
  pixelSolidAngleArcsec2,
  surfaceBrightnessLuminance,
} from '../hdr/emission/emission-pure';
import {
  BASE_EPOCH_EXPOSURE,
  DEFAULT_SUMMATION_ARCSEC2,
} from '../hdr/exposure/exposure-epoch';
import { L_ADAPT } from '../hdr/exposure/scene-adaptation-pure';
import { angularToPx } from '../camera/controls/star-geometry';
import { FOV_MAX_DEG, FOV_MIN_DEG } from '../camera/timing';
import {
  L_THRESH,
  type Rgb,
  displayLevel as displayTransfer,
  relativeLuminance,
  tonemapWhitePoint,
} from '../hdr/tonemap/tonemap-pure';

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

  // Peak-normalised chromaticities, so each authored triplet carries its
  // own luminance and neither is 1: unnormalised, the pair would move the
  // flux split by their DIFFERENCE, which is the figure pinned here. The
  // eyeballed palette this replaced carried 0.390 mag of it (README.md
  // § Population tints). The bulge's own 0.2277 is the shared population
  // constant's, pinned in ../hdr/emission/population-colour-pure.test.ts.
  it('pins what the authored palette would cost unnormalised', () => {
    const lost = (rgb: Rgb) => -2.5 * Math.log10(relativeLuminance(rgb));
    expect(lost(DISC_COLOR_RGB)).toBeCloseTo(0.137, 4);
    expect(lost(BULGE_COLOR_RGB) - lost(DISC_COLOR_RGB)).toBeCloseTo(0.0907, 4);
  });

  // The palette is a pair of colour indices through the star field's own
  // Ballesteros → Planck → CIE path, so the bulge must read WARMER: same
  // red channel at the gamut peak, less blue.
  it('orders the two hues by their colour indices', () => {
    expect(BULGE_COLOUR_INDEX_BV).toBeGreaterThan(DISC_COLOUR_INDEX_BV);
    expect(BULGE_COLOR_RGB[0]).toBe(1);
    expect(DISC_COLOR_RGB[0]).toBe(1);
    expect(BULGE_COLOR_RGB[2]).toBeLessThan(DISC_COLOR_RGB[2]);
    expect(BULGE_COLOR_RGB).toEqual(
      linearSrgbFromColourIndex(BULGE_COLOUR_INDEX_BV),
    );
    expect(DISC_COLOR_RGB).toEqual(
      linearSrgbFromColourIndex(DISC_COLOUR_INDEX_BV),
    );
  });

  // Where "hue never moves flux" stops being true. The tint is
  // luma-normalised at EMISSION, but REDDENING_RGB attenuates per channel
  // inside the same march, so a redder component transmits more of its own
  // light through the same dust: an extincted sightline is chromaticity-
  // dependent even though every dust-free one is not. Both halves are the
  // assertion — the dust-free march has to be bit-identical under any hue,
  // and the extincted one has to move, or the coupling has been broken.
  it('separates hue from flux only where there is no dust', () => {
    const dir = galacticDirection(0, 0);
    const retinted = (bv: number): MilkywayComponent => ({
      ...DISC_COMPONENT,
      colorRgb: lumaNormalisedTint(linearSrgbFromColourIndex(bv)),
    });
    const shipped = retinted(DISC_COLOUR_INDEX_BV);
    const bluer = retinted(DISC_COLOUR_INDEX_BV - 0.3);
    const column = (c: MilkywayComponent, dustEnabled: boolean) =>
      relativeLuminance(
        componentColumnRgb(c, SOL_GALACTOCENTRIC_PC, dir, { dustEnabled }),
      );

    expect(column(bluer, false)).toBeCloseTo(column(shipped, false), 12);
    expect(column(bluer, true)).toBeLessThan(column(shipped, true));
    expect(
      -2.5 * Math.log10(column(bluer, true) / column(shipped, true)),
    ).toBeCloseTo(0.0124, 4);
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

  // The disagreement itself is the assertion, not the arithmetic that
  // produces it: sharing a radial scale length puts the thick/thin
  // LUMINOSITY ratio at 0.12, and Mosenkov et al. 2021 measure
  // 0.71 ± 0.45 at 3.4 µm — outside their interval on the low side, where
  // their thick disc is radially longer as well. Stated rather than tuned
  // (README.md § Density profiles), so a future session that "fixes" the
  // ratio into their band fails here and has to argue with the README.
  it('sits below Mosenkov 2021 on the thick/thin luminosity ratio', () => {
    const ratio =
      (DISC_THICK_DENSITY_FRACTION * DISC_THICK_SCALE_HEIGHT_PC) /
      DISC_SCALE_HEIGHT_PC;
    expect(ratio).toBeCloseTo(0.12, 12);
    expect(ratio).toBeLessThan(0.71 - 0.45);
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

// The emissivity is solved against the Galaxy's integrated luminosity, so
// the solve itself has no tolerance — it either reproduces the published
// pair or it does not. What DOES have a tolerance is every check the solve
// is not anchored on, and those disagreements are the deliverable
// (calibration/README.md).
describe('MilkyWay luminosity solve', () => {
  const totalFlux =
    DISC_DENSITY0 * DISC_VOLUME_INTEGRAL + BULGE_DENSITY0 * BULGE_VOLUME_INTEGRAL;
  const modelAbsMagV =
    -2.5 * Math.log10(totalFlux / ABSOLUTE_MAGNITUDE_DISTANCE_PC ** 2);

  it('integrates both proxy volumes back to the published M_V and B/T', () => {
    expect(GALAXY_TOTAL_ABSMAG_V).toBe(-21.37);
    expect(modelAbsMagV).toBeCloseTo(GALAXY_TOTAL_ABSMAG_V, 12);
    expect((BULGE_DENSITY0 * BULGE_VOLUME_INTEGRAL) / totalFlux).toBeCloseTo(
      BULGE_TO_TOTAL_LIGHT_V,
      12,
    );
  });

  // The envelope clips real light and ρ₀ makes it up, so a tighter envelope
  // BRIGHTENS what is left rather than losing it. Pinned because that is
  // the one way the truncation can bite: it is silent in the total and
  // visible only in the profile it redistributes.
  //
  // Measured against ALL SPACE, whose closed form is exact — not against a
  // vertically-loosened ellipsoid, which is what the envelope is clipping
  // relative to only if you pick its radius, and which reports 0.031 for a
  // clip that is really 0.076. The radial direction dominates and cannot
  // be separated out: the envelope is one ellipsoid, and at 15 kpc against
  // a 3 kpc scale length it still cuts exp(−(15000 − R₀)/3000) = 0.10 of
  // the midplane emissivity at the rim.
  it('compensates the disc envelope truncation into ρ₀', () => {
    const allSpace =
      2 * Math.PI *
      Math.exp(R0_PC / DISC_SCALE_LENGTH_PC) *
      DISC_SCALE_LENGTH_PC ** 2 *
      2 *
      (DISC_SCALE_HEIGHT_PC +
        DISC_THICK_DENSITY_FRACTION * DISC_THICK_SCALE_HEIGHT_PC);
    expect(-2.5 * Math.log10(DISC_VOLUME_INTEGRAL / allSpace)).toBeCloseTo(
      0.0757,
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
    expect(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2 - dustFree).toBeCloseTo(1.676, 3);
  });

  // Check 2, the sightline the ORIGINAL anchor used. Compared against
  // Leinert's total rather than a residual: the catalogue row toward the
  // centre is de-extincted and so not commensurable there
  // (calibration/diffuse-reference.ts), and it would only widen the gap.
  // Same species of disagreement as the pole, which is what says it is a
  // scale difference between two published sources and not a shape error.
  it('states the Galactic-centre sightline against Leinert’s total', () => {
    expect(
      LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.galacticCentre -
        GC_SIGHTLINE_MAG_ARCSEC2,
    ).toBeCloseTo(1.043, 3);
  });

  // The cross-layer symptom the epic opened on: the Galaxy seen from M31
  // has to be at least as bright as M31 seen from here, and under the
  // sightline anchor it was 1.11 mag fainter. M31's own photometry is read
  // from the build's source of truth so a catalogue edit moves this pin
  // rather than silently invalidating it.
  it('orders the Galaxy from M31 against M31 from Sol', () => {
    const row = parseOverrides(
      readFileSync(
        fileURLToPath(new URL('../../../data/local-group/overrides.tsv', import.meta.url)),
        'utf-8',
      ),
    ).find((o) => o.name === 'M31');
    if (row?.distanceKpc === undefined || row.mV === undefined) {
      throw new Error('M31 row in overrides.tsv is missing distance or m_V');
    }
    const m31DistancePc = row.distanceKpc * 1000;
    const m31ApparentV = row.mV;
    expect(m31ApparentV).toBeCloseTo(3.44, 6);

    const galaxyFromM31 =
      modelAbsMagV +
      5 * Math.log10(m31DistancePc / ABSOLUTE_MAGNITUDE_DISTANCE_PC);
    expect(galaxyFromM31).toBeCloseTo(3.079, 3);
    expect(galaxyFromM31).toBeLessThan(m31ApparentV);
    expect(m31ApparentV - galaxyFromM31).toBeCloseTo(0.361, 3);
  });

  // The split conserves the total, so the pin above cannot see it at all —
  // and the Sol sightlines barely can either, because the bulge sits behind
  // 4.6 τ_V from here. Where a mass-for-light substitution actually shows
  // is the face-on external view, which is the one the camera can reach
  // (AGENTS.md § Camera-anywhere, any-epoch): it is the bulge/disc contrast
  // that makes the model read as an Sbc rather than an S0.
  //
  // Edge-on is pinned alongside as the opposite extreme: the bulge sits
  // behind the full midplane dust column and contributes essentially
  // nothing, which is what a real edge-on spiral looks like in V and is why
  // face-on is the only external geometry that constrains the split.
  it('pins the bulge/disc contrast the external view actually shows', () => {
    const centrePixelBulgeShare = (originPc: Vec3) => {
      const scale = Math.hypot(...originPc);
      const toCentre: Vec3 = [
        -originPc[0] / scale,
        -originPc[1] / scale,
        -originPc[2] / scale,
      ];
      return componentLuminanceShare(BULGE_COMPONENT, originPc, toCentre);
    };

    expect(centrePixelBulgeShare([0, 0, 100_000])).toBeCloseTo(0.305, 3);
    expect(centrePixelBulgeShare([-100_000, 0, 0])).toBeCloseTo(5.0084e-5, 8);

    // The integrated ratio the density0 split sets, which the face-on
    // number above is the marched consequence of. Under the mass B/T it
    // was 0.176 and the face-on centre pixel read 0.480 bulge.
    expect(
      (BULGE_DENSITY0 * BULGE_VOLUME_INTEGRAL) /
        (DISC_DENSITY0 * DISC_VOLUME_INTEGRAL),
    ).toBeCloseTo(0.0840, 4);
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

const displayLevel = (l: number) => displayTransfer(l, tonemapWhitePoint());

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
    expect(GC_SIGHTLINE_COLUMN).toBeCloseTo(75.520, 3);
    expect(GC_SIGHTLINE_MAG_ARCSEC2).toBeCloseTo(21.877, 3);
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
    expect(s(0, 90) - dustFree).toBeCloseTo(0.0852, 4);
    expect(s(180, 0)).toBeCloseTo(22.061, 3);
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
    expect(s(5)).toBeCloseTo(20.744, 3);
    expect(s(0)).toBeCloseTo(21.877, 3);
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
    expect(at(4) - at(0)).toBeCloseTo(0.333, 3);
  });

  // The plane-to-pole contrast the retired anchor got wrong by 4 mag.
  it('pins the latitude contrast the dust normalisation sets', () => {
    const s = (lDeg: number, bDeg: number) =>
      sightlineSurfaceBrightness(
        SB_ZERO_POINT,
        SOL_GALACTOCENTRIC_PC,
        galacticDirection(lDeg, bDeg),
      );
    expect(s(0, 90) - s(0, 0)).toBeCloseTo(1.524, 3);
  });

  // The whole band, in 8-bit display levels at the base epoch with no EV
  // trim. Pinned as a table because the ORDERING is the acceptance. The
  // faint-end toe is in these figures: sightlines over the extended
  // threshold are untouched, sub-threshold ones roll off, and the pole —
  // 1.40 mag under, pre-toe 15.65 — lands back on the dither floor
  // because a patch the modelled eye cannot detect must not read plainly
  // visible (calibration/README.md).
  it('pins the band against a threshold star at the base epoch', () => {
    expect(displayLevel(L_THRESH) * 255).toBeCloseTo(38.25, 2);

    expect(bandDisplayLevel(sbAt(0, 5)) * 255).toBeCloseTo(69.18, 2);
    expect(bandDisplayLevel(GC_SIGHTLINE_MAG_ARCSEC2) * 255).toBeCloseTo(40.73, 2);
    expect(bandDisplayLevel(sbAt(180, 0)) * 255).toBeCloseTo(36.95, 2);
    expect(bandDisplayLevel(sbAt(0, 30)) * 255).toBeCloseTo(22.04, 2);
    expect(bandDisplayLevel(sbAt(0, 90)) * 255).toBeCloseTo(0.85, 2);
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

    expect(sbAt(0, 5) - sLim).toBeCloseTo(-1.256, 3);
    expect(GC_SIGHTLINE_MAG_ARCSEC2 - sLim).toBeCloseTo(-0.123, 3);
    expect(sbAt(180, 0) - sLim).toBeCloseTo(0.061, 3);
    expect(sbAt(0, 30) - sLim).toBeCloseTo(0.521, 3);
    expect(sbAt(0, 90) - sLim).toBeCloseTo(1.401, 3);

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
  // does write cannot provoke an adaptation cut. It cannot, twice over: a
  // diffuse column writes no lit-surface mask, so it can never reach the
  // resolved-surface pin, and its own level sits 3.5 stops under the
  // perception branch's anchor. The margin is measured on the Ω_px value the
  // statistic actually carries, not on the 12x-larger level the band
  // displays at (../hdr/attachments/README.md § The unit).
  it('writes a statistic the adaptation cut cannot act on', () => {
    const statisticL = surfaceBrightnessLuminance(
      BASE_EPOCH_EXPOSURE,
      sbAt(0, 5),
      REFERENCE_OMEGA_PX,
    );
    expect(statisticL).toBeCloseTo(5.3167e-3, 6);
    expect(Math.log2(L_ADAPT / statisticL)).toBeCloseTo(3.5, 1);
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
    expect(worst).toBeCloseTo(0.00281, 5);
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
